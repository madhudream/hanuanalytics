//! IP -> country / region / city with the DB-IP City Lite database (CC BY 4.0, attribution: https://db-ip.com).
//! "auto" mode downloads the current month's file once, keeps a copy in the bucket (so a new VM does not hit
//! db-ip again) and refreshes monthly. Lookups are in-memory and take microseconds.
use crate::store::Store;
use anyhow::{anyhow, Context, Result};
use bytes::Bytes;
use maxminddb::{geoip2, Mmap, Reader};
use parking_lot::RwLock;
use std::net::IpAddr;
use std::sync::Arc;

#[derive(Clone, Debug, Default)]
pub struct GeoResult {
    pub country: String, // ISO-2
    pub region: String,
    pub city: String,
}

pub struct Geo {
    reader: RwLock<Option<Arc<Reader<Mmap>>>>,
    pub build: RwLock<String>,
}

impl Geo {
    pub fn empty() -> Self {
        Geo { reader: RwLock::new(None), build: RwLock::new(String::new()) }
    }

    pub fn loaded(&self) -> bool {
        self.reader.read().is_some()
    }

    /// Memory-map the database file (the kernel pages it in as needed; nothing is copied into the heap).
    pub fn load_path(&self, path: &std::path::Path, label: &str) -> Result<()> {
        // SAFETY: the file is written once (atomic rename) and never modified while mapped; a monthly refresh
        // maps a new file and drops the old reader.
        let r = unsafe { Reader::open_mmap(path) }.with_context(|| format!("mmdb {}", path.display()))?;
        let epoch = r.metadata().build_epoch;
        let built = chrono::DateTime::from_timestamp(epoch as i64, 0).map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default();
        *self.build.write() = format!("{label} (built {built})");
        *self.reader.write() = Some(Arc::new(r));
        Ok(())
    }

    pub fn lookup(&self, ip: IpAddr) -> GeoResult {
        let reader = match self.reader.read().clone() {
            Some(r) => r,
            None => return GeoResult::default(),
        };
        if is_private(&ip) {
            return GeoResult::default();
        }
        let res = match reader.lookup(ip) {
            Ok(r) => r,
            Err(_) => return GeoResult::default(),
        };
        let city: Option<geoip2::City> = res.decode().ok().flatten();
        match city {
            Some(c) => GeoResult {
                country: c.country.iso_code.unwrap_or("").to_string(),
                region: c.subdivisions.first().and_then(|s| s.names.english).unwrap_or("").to_string(),
                city: c.city.names.english.unwrap_or("").to_string(),
            },
            None => GeoResult::default(),
        }
    }
}

fn is_private(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => v.is_private() || v.is_loopback() || v.is_link_local() || v.is_unspecified(),
        IpAddr::V6(v) => v.is_loopback() || v.is_unspecified() || (v.segments()[0] & 0xfe00) == 0xfc00 || (v.segments()[0] & 0xffc0) == 0xfe80,
    }
}

/// The key of the month's cached copy in the bucket.
fn month_key() -> String {
    format!("geo/dbip-city-lite-{}.mmdb", chrono::Utc::now().format("%Y-%m"))
}

fn month_url() -> String {
    format!("https://download.db-ip.com/free/dbip-city-lite-{}.mmdb.gz", chrono::Utc::now().format("%Y-%m"))
}

/// Load from the bucket cache, else download this month's file (falling back to the previous month).
pub async fn load_auto(geo: &Geo, store: &Store) -> Result<()> {
    let key = month_key();
    if store.get(&key).await?.is_some() {
        geo.load_path(&store.local_path(&key), &key)?;
        return Ok(());
    }
    // any older cached month works while this month downloads
    let mut cached: Vec<String> = store.list("geo/").await.unwrap_or_default().into_iter().map(|f| f.key).filter(|k| k.ends_with(".mmdb")).collect();
    cached.sort();
    if let Some(old) = cached.last() {
        if store.get(old).await?.is_some() {
            let _ = geo.load_path(&store.local_path(old), old);
        }
    }
    let bytes = download(&month_url()).await.or_else(|e| {
        tracing::warn!("geo: this month's file not available yet ({e}); trying last month");
        Err(e)
    });
    let (bytes, label) = match bytes {
        Ok(b) => (b, key.clone()),
        Err(_) => {
            let prev = chrono::Utc::now().date_naive().with_day(1).unwrap().pred_opt().unwrap();
            let url = format!("https://download.db-ip.com/free/dbip-city-lite-{}.mmdb.gz", prev.format("%Y-%m"));
            (download(&url).await?, format!("geo/dbip-city-lite-{}.mmdb", prev.format("%Y-%m")))
        }
    };
    store.put(&label, bytes).await?;
    geo.load_path(&store.local_path(&label), &label)?;
    Ok(())
}

async fn download(url: &str) -> Result<Bytes> {
    let res = reqwest::Client::builder().timeout(std::time::Duration::from_secs(300)).build()?.get(url).header("User-Agent", "hanuanalytics/0.1 (+https://github.com/madhudream/hanuanalytics)").send().await?;
    if !res.status().is_success() {
        return Err(anyhow!("geo download {url}: {}", res.status()));
    }
    let gz = res.bytes().await?;
    let out = tokio::task::spawn_blocking(move || -> Result<Vec<u8>> {
        use std::io::Read;
        let mut d = flate2::read::GzDecoder::new(&gz[..]);
        let mut v = Vec::with_capacity(gz.len() * 3);
        d.read_to_end(&mut v)?;
        Ok(v)
    })
    .await??;
    Ok(Bytes::from(out))
}

pub fn load_file(geo: &Geo, path: &str) -> Result<()> {
    geo.load_path(std::path::Path::new(path), path)
}

pub use chrono::Datelike;
