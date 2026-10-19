//! The durable home (a bucket) and its local mirror. Every object is written to disk first and then uploaded;
//! reads come from disk when present, else from the bucket (and are cached). A reconcile pass uploads anything
//! the bucket is missing, so a failed upload is never lost while the disk lives, and a new VM rebuilds its
//! cache from the bucket alone — the same philosophy as HanuDB.
use anyhow::{anyhow, Context, Result};
use bytes::Bytes;
use futures::StreamExt;
use object_store::{path::Path as OPath, ObjectStore, ObjectStoreExt, PutPayload};
use parking_lot::RwLock;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone)]
pub struct Store {
    remote: Arc<dyn ObjectStore>,
    prefix: OPath,
    dir: PathBuf,
    pub kind: String,
    pub remote_url: String,
    pub catalog: Arc<RwLock<Catalog>>,
    pub uploads_failed: Arc<AtomicU64>,
    pub uploads_ok: Arc<AtomicU64>,
    /// per-project lock: writers/compaction take it exclusively, analytics queries share it
    locks: Arc<parking_lot::Mutex<HashMap<String, Arc<tokio::sync::RwLock<()>>>>>,
}

#[derive(Clone, Debug)]
pub struct FileInfo {
    pub key: String,
    pub size: u64,
}

/// Which event files exist, per project and day. Kept in memory; rebuilt from a bucket listing at boot.
#[derive(Default)]
pub struct Catalog {
    pub events: HashMap<String, BTreeMap<String, Vec<FileInfo>>>,
    pub recordings: HashMap<String, u64>, // project -> number of session prefixes (approx)
}

impl Catalog {
    pub fn add(&mut self, key: &str, size: u64) {
        if let Some((project, day)) = parse_event_key(key) {
            let days = self.events.entry(project).or_default();
            let files = days.entry(day).or_default();
            if !files.iter().any(|f| f.key == key) {
                files.push(FileInfo { key: key.to_string(), size });
            }
        }
    }
    pub fn remove(&mut self, key: &str) {
        if let Some((project, day)) = parse_event_key(key) {
            if let Some(days) = self.events.get_mut(&project) {
                if let Some(files) = days.get_mut(&day) {
                    files.retain(|f| f.key != key);
                    if files.is_empty() {
                        days.remove(&day);
                    }
                }
            }
        }
    }
    pub fn files(&self, project: &str, from_day: &str, to_day: &str) -> Vec<FileInfo> {
        match self.events.get(project) {
            Some(days) => days.range(from_day.to_string()..=to_day.to_string()).flat_map(|(_, f)| f.iter().cloned()).collect(),
            None => vec![],
        }
    }
    pub fn days(&self, project: &str) -> Vec<(String, Vec<FileInfo>)> {
        self.events.get(project).map(|d| d.iter().map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default()
    }
    pub fn total_files(&self) -> usize {
        self.events.values().map(|d| d.values().map(|f| f.len()).sum::<usize>()).sum()
    }
}

/// `events/p=<project>/d=<day>/<file>.parquet` -> (project, day)
pub fn parse_event_key(key: &str) -> Option<(String, String)> {
    let rest = key.strip_prefix("events/p=")?;
    let (project, rest) = rest.split_once("/d=")?;
    let (day, file) = rest.split_once('/')?;
    if !file.ends_with(".parquet") {
        return None;
    }
    Some((project.to_string(), day.to_string()))
}

impl Store {
    pub async fn open(url: &str, dir: &str) -> Result<Store> {
        let dir = PathBuf::from(dir);
        std::fs::create_dir_all(&dir).with_context(|| format!("create {}", dir.display()))?;
        let (remote, prefix, kind): (Arc<dyn ObjectStore>, OPath, String) = if let Some(rest) = url.strip_prefix("gs://") {
            let (bucket, prefix) = rest.split_once('/').unwrap_or((rest, ""));
            let s = object_store::gcp::GoogleCloudStorageBuilder::from_env().with_bucket_name(bucket).build().context("gcs client")?;
            (Arc::new(s), OPath::from(prefix.trim_matches('/')), "gcs".into())
        } else if let Some(rest) = url.strip_prefix("s3://") {
            let (bucket, prefix) = rest.split_once('/').unwrap_or((rest, ""));
            let s = object_store::aws::AmazonS3Builder::from_env().with_bucket_name(bucket).build().context("s3 client")?;
            (Arc::new(s), OPath::from(prefix.trim_matches('/')), "s3".into())
        } else if url.starts_with("mem://") {
            (Arc::new(object_store::memory::InMemory::new()), OPath::from(""), "memory".into())
        } else if let Some(p) = url.strip_prefix("file://") {
            let p = PathBuf::from(p);
            std::fs::create_dir_all(&p)?;
            let p = p.canonicalize()?;
            (Arc::new(object_store::local::LocalFileSystem::new_with_prefix(&p)?), OPath::from(""), "file".into())
        } else {
            return Err(anyhow!("unsupported bucket url {url} (use gs://, s3://, file:// or mem://)"));
        };
        let store = Store {
            remote,
            prefix,
            dir,
            kind,
            remote_url: url.to_string(),
            catalog: Arc::new(RwLock::new(Catalog::default())),
            uploads_failed: Arc::new(AtomicU64::new(0)),
            uploads_ok: Arc::new(AtomicU64::new(0)),
            locks: Arc::new(parking_lot::Mutex::new(HashMap::new())),
        };
        Ok(store)
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn lock_for(&self, project: &str) -> Arc<tokio::sync::RwLock<()>> {
        self.locks.lock().entry(project.to_string()).or_insert_with(|| Arc::new(tokio::sync::RwLock::new(()))).clone()
    }

    fn rpath(&self, key: &str) -> OPath {
        if self.prefix.as_ref().is_empty() {
            OPath::from(key)
        } else {
            OPath::from(format!("{}/{}", self.prefix.as_ref(), key))
        }
    }

    pub fn local_path(&self, key: &str) -> PathBuf {
        self.dir.join(key)
    }

    pub fn has_local(&self, key: &str) -> bool {
        self.local_path(key).is_file()
    }

    /// Write locally, then upload (retried). Returns once the local write is durable.
    pub async fn put(&self, key: &str, bytes: Bytes) -> Result<()> {
        self.write_local(key, &bytes).await?;
        self.upload(key, bytes).await
    }

    pub async fn write_local(&self, key: &str, bytes: &Bytes) -> Result<()> {
        let path = self.local_path(key);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let tmp = path.with_extension("tmp");
        tokio::fs::write(&tmp, bytes).await?;
        tokio::fs::rename(&tmp, &path).await?;
        Ok(())
    }

    pub async fn upload(&self, key: &str, bytes: Bytes) -> Result<()> {
        let path = self.rpath(key);
        let mut delay = Duration::from_millis(500);
        let mut last = None;
        for _ in 0..5 {
            match self.remote.put(&path, PutPayload::from_bytes(bytes.clone())).await {
                Ok(_) => {
                    self.uploads_ok.fetch_add(1, Ordering::Relaxed);
                    return Ok(());
                }
                Err(e) => {
                    last = Some(e);
                    tokio::time::sleep(delay).await;
                    delay *= 2;
                }
            }
        }
        self.uploads_failed.fetch_add(1, Ordering::Relaxed);
        Err(anyhow!("upload {key}: {}", last.map(|e| e.to_string()).unwrap_or_default()))
    }

    /// Local first; else fetch from the bucket and cache on disk.
    pub async fn get(&self, key: &str) -> Result<Option<Bytes>> {
        let path = self.local_path(key);
        if let Ok(b) = tokio::fs::read(&path).await {
            return Ok(Some(Bytes::from(b)));
        }
        match self.remote.get(&self.rpath(key)).await {
            Ok(r) => {
                let b = r.bytes().await?;
                let _ = self.write_local(key, &b).await;
                Ok(Some(b))
            }
            Err(object_store::Error::NotFound { .. }) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Make sure these keys are on disk (downloading up to 8 at a time).
    pub async fn ensure_local(&self, keys: Vec<String>) -> Result<usize> {
        let missing: Vec<String> = keys.into_iter().filter(|k| !self.has_local(k)).collect();
        if missing.is_empty() {
            return Ok(0);
        }
        let n = missing.len();
        let results: Vec<Result<()>> = futures::stream::iter(missing)
            .map(|k| async move { self.get(&k).await.map(|_| ()) })
            .buffer_unordered(8)
            .collect()
            .await;
        for r in results {
            r?;
        }
        Ok(n)
    }

    pub async fn delete(&self, key: &str) -> Result<()> {
        let _ = tokio::fs::remove_file(self.local_path(key)).await;
        match self.remote.delete(&self.rpath(key)).await {
            Ok(_) | Err(object_store::Error::NotFound { .. }) => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn list(&self, prefix: &str) -> Result<Vec<FileInfo>> {
        let p = self.rpath(prefix);
        let mut stream = self.remote.list(Some(&p));
        let mut out = vec![];
        let strip = if self.prefix.as_ref().is_empty() { String::new() } else { format!("{}/", self.prefix.as_ref()) };
        while let Some(item) = stream.next().await {
            let m = item?;
            let key = m.location.as_ref().strip_prefix(&strip).unwrap_or(m.location.as_ref()).to_string();
            out.push(FileInfo { key, size: m.size });
        }
        Ok(out)
    }

    /// List everything under a prefix on disk (keys relative to the store root).
    pub fn list_local(&self, prefix: &str) -> Vec<FileInfo> {
        let root = self.local_path(prefix);
        let mut out = vec![];
        fn walk(base: &Path, dir: &Path, out: &mut Vec<FileInfo>) {
            if let Ok(rd) = std::fs::read_dir(dir) {
                for e in rd.flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        walk(base, &p, out);
                    } else if let Ok(rel) = p.strip_prefix(base) {
                        if p.extension().map(|e| e == "tmp").unwrap_or(false) {
                            continue;
                        }
                        let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                        out.push(FileInfo { key: rel.to_string_lossy().replace('\\', "/"), size });
                    }
                }
            }
        }
        walk(&self.dir, &root, &mut out);
        out
    }

    /// Build the event catalog from the bucket, plus anything on disk the bucket lacks (and upload those).
    pub async fn load_catalog(&self) -> Result<usize> {
        let remote = self.list("events/").await?;
        let mut cat = Catalog::default();
        let mut remote_keys = std::collections::HashSet::new();
        for f in &remote {
            remote_keys.insert(f.key.clone());
            cat.add(&f.key, f.size);
        }
        let local = self.list_local("events/");
        let mut to_upload = vec![];
        for f in local {
            if !remote_keys.contains(&f.key) && f.key.ends_with(".parquet") {
                cat.add(&f.key, f.size);
                to_upload.push(f.key);
            }
        }
        let n = cat.total_files();
        *self.catalog.write() = cat;
        for key in to_upload {
            if let Ok(b) = tokio::fs::read(self.local_path(&key)).await {
                if let Err(e) = self.upload(&key, Bytes::from(b)).await {
                    tracing::warn!("reconcile upload failed: {e}");
                }
            }
        }
        Ok(n)
    }

    /// Upload local files the bucket is missing (events and recordings). Called periodically.
    pub async fn reconcile(&self) -> Result<usize> {
        let mut uploaded = 0;
        for prefix in ["events/", "rec/"] {
            let remote: std::collections::HashSet<String> = self.list(prefix).await?.into_iter().map(|f| f.key).collect();
            for f in self.list_local(prefix) {
                if !remote.contains(&f.key) {
                    if let Ok(b) = tokio::fs::read(self.local_path(&f.key)).await {
                        if self.upload(&f.key, Bytes::from(b)).await.is_ok() {
                            uploaded += 1;
                        }
                    }
                }
            }
        }
        Ok(uploaded)
    }

    pub async fn remote_ok(&self) -> bool {
        self.remote.list_with_delimiter(Some(&self.rpath("events"))).await.is_ok()
    }

    pub fn disk_used(&self) -> u64 {
        fn size(p: &Path) -> u64 {
            let mut t = 0;
            if let Ok(rd) = std::fs::read_dir(p) {
                for e in rd.flatten() {
                    let m = match e.metadata() {
                        Ok(m) => m,
                        Err(_) => continue,
                    };
                    if m.is_dir() {
                        t += size(&e.path());
                    } else {
                        t += m.len();
                    }
                }
            }
            t
        }
        size(&self.dir)
    }
}
