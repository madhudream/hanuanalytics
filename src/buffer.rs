//! The write path for events: an in-memory buffer per project, flushed to one Parquet file per
//! (project, UTC day) every `flush_secs` seconds or `flush_events` events; hourly compaction of the previous
//! hour's small files and a daily merge of yesterday's files keep the file count low; retention deletes old days.
use crate::events::{self, Event};
use crate::store::Store;
use anyhow::{Context, Result};
use bytes::Bytes;
use datafusion::arrow::record_batch::RecordBatch;
use datafusion::parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct Buffer {
    store: Store,
    node: String,
    flush_secs: u64,
    flush_events: usize,
    inner: Mutex<HashMap<String, (i64, Vec<Event>)>>, // project -> (first buffered at, events)
    seq: AtomicU64,
    pub last_flush_at: AtomicI64,
    pub events_written: AtomicU64,
}

impl Buffer {
    pub fn new(store: Store, node: String, flush_secs: u64, flush_events: usize) -> Self {
        Buffer {
            store,
            node,
            flush_secs,
            flush_events,
            inner: Mutex::new(HashMap::new()),
            seq: AtomicU64::new(0),
            last_flush_at: AtomicI64::new(0),
            events_written: AtomicU64::new(0),
        }
    }

    pub fn lock_for(&self, project: &str) -> Arc<RwLock<()>> {
        self.store.lock_for(project)
    }

    /// Push events; returns true when the caller should flush this project now.
    pub fn push(&self, project: &str, mut events: Vec<Event>) -> bool {
        let mut m = self.inner.lock();
        let e = m.entry(project.to_string()).or_insert_with(|| (crate::ids::now_ms(), Vec::new()));
        e.1.append(&mut events);
        e.1.len() >= self.flush_events
    }

    pub fn pending(&self) -> usize {
        self.inner.lock().values().map(|(_, v)| v.len()).sum()
    }

    /// Projects whose buffer is older than flush_secs (or all, when `all`).
    fn due(&self, all: bool) -> Vec<(String, Vec<Event>)> {
        let now = crate::ids::now_ms();
        let mut m = self.inner.lock();
        let mut out = vec![];
        let keys: Vec<String> = m.keys().cloned().collect();
        for k in keys {
            let due = {
                let (t0, v) = m.get(&k).unwrap();
                !v.is_empty() && (all || now - *t0 >= (self.flush_secs * 1000) as i64 || v.len() >= self.flush_events)
            };
            if due {
                let (_, v) = m.remove(&k).unwrap();
                out.push((k, v));
            }
        }
        out
    }

    pub async fn flush_project(&self, project: &str) -> Result<usize> {
        let taken = {
            let mut m = self.inner.lock();
            m.remove(project).map(|(_, v)| v).unwrap_or_default()
        };
        if taken.is_empty() {
            return Ok(0);
        }
        self.write(project, taken).await
    }

    pub async fn flush(&self, all: bool) -> Result<usize> {
        let mut n = 0;
        for (project, events) in self.due(all) {
            match self.write(&project, events).await {
                Ok(k) => n += k,
                Err(e) => tracing::error!("flush {project}: {e:#}"),
            }
        }
        Ok(n)
    }

    /// Write events as one Parquet file per UTC day.
    async fn write(&self, project: &str, events: Vec<Event>) -> Result<usize> {
        let mut by_day: HashMap<String, Vec<Event>> = HashMap::new();
        for e in events {
            let day = chrono::DateTime::from_timestamp_millis(e.ts).map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_else(|| "1970-01-01".into());
            by_day.entry(day).or_default().push(e);
        }
        let mut total = 0;
        let lock = self.lock_for(project);
        for (day, evs) in by_day {
            let n = evs.len();
            let bytes = tokio::task::spawn_blocking(move || events::write_parquet(evs)).await??;
            let seq = self.seq.fetch_add(1, Ordering::Relaxed);
            let key = format!("events/p={project}/d={day}/{}-{}-{seq}.parquet", chrono::Utc::now().format("%H%M%S"), self.node);
            {
                let _g = lock.write().await;
                self.store.write_local(&key, &Bytes::from(bytes.clone())).await?;
                self.store.catalog.write().add(&key, bytes.len() as u64);
            }
            // the upload happens outside the lock; the reconcile pass covers a failure
            let store = self.store.clone();
            let k2 = key.clone();
            tokio::spawn(async move {
                if let Err(e) = store.upload(&k2, Bytes::from(bytes)).await {
                    tracing::warn!("{e:#} (will retry on reconcile)");
                }
            });
            total += n;
        }
        self.events_written.fetch_add(total as u64, Ordering::Relaxed);
        self.last_flush_at.store(crate::ids::now_ms(), Ordering::Relaxed);
        Ok(total)
    }

    /// Merge every file of (project, day) whose name starts with one of `hours` ("HH" prefixes; empty = all)
    /// into one file. Returns the number of files merged away.
    pub async fn compact(&self, project: &str, day: &str, hours: &[String]) -> Result<usize> {
        let files: Vec<String> = {
            let cat = self.store.catalog.read();
            cat.files(project, day, day)
                .into_iter()
                .map(|f| f.key)
                .filter(|k| {
                    let name = k.rsplit('/').next().unwrap_or("");
                    hours.is_empty() || hours.iter().any(|h| name.starts_with(h.as_str()))
                })
                .collect()
        };
        if files.len() < 2 {
            return Ok(0);
        }
        self.store.ensure_local(files.clone()).await?;
        let paths: Vec<std::path::PathBuf> = files.iter().map(|k| self.store.local_path(k)).collect();
        let merged = tokio::task::spawn_blocking(move || -> Result<Vec<u8>> {
            let mut batches: Vec<RecordBatch> = vec![];
            for p in &paths {
                let f = std::fs::File::open(p).with_context(|| format!("open {}", p.display()))?;
                let reader = ParquetRecordBatchReaderBuilder::try_new(f)?.with_batch_size(65536).build()?;
                for b in reader {
                    batches.push(b?);
                }
            }
            if batches.is_empty() {
                return Ok(vec![]);
            }
            let schema = events::schema();
            let one = datafusion::arrow::compute::concat_batches(&schema, &batches)?;
            let idx = datafusion::arrow::compute::sort_to_indices(one.column(0), None, None)?;
            let cols: Result<Vec<_>, _> = one.columns().iter().map(|c| datafusion::arrow::compute::take(c, &idx, None)).collect();
            let sorted = RecordBatch::try_new(schema, cols?)?;
            events::write_batches(&[sorted])
        })
        .await??;
        if merged.is_empty() {
            return Ok(0);
        }
        let label = if hours.len() == 1 { hours[0].clone() } else { "day".into() };
        let seq = self.seq.fetch_add(1, Ordering::Relaxed);
        let key = format!("events/p={project}/d={day}/{label}-merged-{}-{seq}.parquet", self.node);
        let lock = self.lock_for(project);
        // write the merged file into the bucket first, then swap locally under the lock, then delete the parts
        self.store.write_local(&key, &Bytes::from(merged.clone())).await?;
        self.store.upload(&key, Bytes::from(merged.clone())).await?;
        {
            let _g = lock.write().await;
            let mut cat = self.store.catalog.write();
            cat.add(&key, merged.len() as u64);
            for f in &files {
                cat.remove(f);
            }
        }
        for f in &files {
            if let Err(e) = self.store.delete(f).await {
                tracing::warn!("delete {f}: {e}");
            }
        }
        Ok(files.len())
    }

    /// Hourly job: merge the previous hour's files for today, for every project with more than one.
    pub async fn compact_recent(&self) -> Result<usize> {
        let now = chrono::Utc::now();
        let prev = now - chrono::Duration::hours(1);
        let day = prev.format("%Y-%m-%d").to_string();
        let hour = prev.format("%H").to_string();
        let projects: Vec<String> = self.store.catalog.read().events.keys().cloned().collect();
        let mut n = 0;
        for p in projects {
            // files from the previous hour that are not yet merged
            let unmerged: Vec<String> = self
                .store
                .catalog
                .read()
                .files(&p, &day, &day)
                .into_iter()
                .map(|f| f.key)
                .filter(|k| {
                    let name = k.rsplit('/').next().unwrap_or("");
                    name.starts_with(&hour) && !name.contains("-merged-")
                })
                .collect();
            if unmerged.len() >= 2 {
                match self.compact(&p, &day, &[hour.clone()]).await {
                    Ok(k) => n += k,
                    Err(e) => tracing::warn!("compact {p} {day} {hour}: {e:#}"),
                }
            }
        }
        Ok(n)
    }

    /// Daily job: merge every file of yesterday (and any older day that still has several) into one.
    pub async fn compact_days(&self) -> Result<usize> {
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let work: Vec<(String, String)> = {
            let cat = self.store.catalog.read();
            let mut w = vec![];
            for (p, days) in &cat.events {
                for (d, files) in days {
                    if d < &today && files.len() >= 2 {
                        w.push((p.clone(), d.clone()));
                    }
                }
            }
            w
        };
        let mut n = 0;
        for (p, d) in work {
            match self.compact(&p, &d, &[]).await {
                Ok(k) => n += k,
                Err(e) => tracing::warn!("compact {p} {d}: {e:#}"),
            }
        }
        Ok(n)
    }

    /// Delete event days older than the project's retention.
    pub async fn apply_retention(&self, project: &str, retention_days: u32) -> Result<usize> {
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(retention_days as i64)).format("%Y-%m-%d").to_string();
        let old: Vec<String> = {
            let cat = self.store.catalog.read();
            cat.days(project).into_iter().filter(|(d, _)| d < &cutoff).flat_map(|(_, f)| f.into_iter().map(|x| x.key)).collect()
        };
        let lock = self.lock_for(project);
        let mut n = 0;
        for k in old {
            {
                let _g = lock.write().await;
                self.store.catalog.write().remove(&k);
            }
            if self.store.delete(&k).await.is_ok() {
                n += 1;
            }
        }
        Ok(n)
    }

    /// Delete everything of a project (events on disk + bucket). Recordings are handled by the recordings store.
    pub async fn delete_project(&self, project: &str) -> Result<usize> {
        let keys: Vec<String> = { self.store.catalog.read().days(project).into_iter().flat_map(|(_, f)| f.into_iter().map(|x| x.key)).collect() };
        let n = keys.len();
        {
            self.store.catalog.write().events.remove(project);
        }
        for k in keys {
            let _ = self.store.delete(&k).await;
        }
        let _ = tokio::fs::remove_dir_all(self.store.local_path(&format!("events/p={project}"))).await;
        Ok(n)
    }
}
