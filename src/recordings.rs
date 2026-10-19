//! rrweb recordings: chunks from the SDK are buffered per session and written as gzip JSON objects to
//! `rec/p=<project>/s=<session>/<n>.json.gz` when the buffer passes 512 KB or the session has been quiet
//! for 30 s. Few, larger objects keep the bucket's class-A operations (the only real cost) low.
use crate::sessions::Index;
use crate::store::Store;
use anyhow::Result;
use bytes::Bytes;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::io::Write;

struct Pending {
    project: String,
    session: String,
    distinct_id: String,
    /// raw JSON of events, already comma-joined (no surrounding brackets)
    body: Vec<u8>,
    events: usize,
    first_ts: i64,
    last_ts: i64,
    last_seq: i64,
    next_object: i64,
    last_append: i64,
}

pub struct Recordings {
    store: Store,
    pending: Mutex<HashMap<String, Pending>>,
}

const FLUSH_BYTES: usize = 512 * 1024;
const IDLE_MS: i64 = 30_000;

impl Recordings {
    pub fn new(store: Store) -> Self {
        Recordings { store, pending: Mutex::new(HashMap::new()) }
    }

    pub fn key(project: &str, session: &str) -> String {
        format!("{project}:{session}")
    }

    /// Append a chunk. `events_json` is the raw JSON array text of the chunk's events.
    pub async fn append(&self, project: &str, session: &str, distinct_id: &str, seq: i64, events_json: &[u8], first_ts: i64, last_ts: i64, n_events: usize, index: &Index) -> Result<()> {
        let inner = events_json.trim_ascii();
        let inner = inner.strip_prefix(b"[").and_then(|s| s.strip_suffix(b"]")).unwrap_or(inner);
        if inner.is_empty() {
            return Ok(());
        }
        let key = Self::key(project, session);
        let flush_now = {
            let mut m = self.pending.lock();
            let p = m.entry(key.clone()).or_insert_with(|| Pending {
                project: project.into(),
                session: session.into(),
                distinct_id: distinct_id.into(),
                body: Vec::with_capacity(inner.len() * 4),
                events: 0,
                first_ts,
                last_ts,
                last_seq: -1,
                next_object: -1,
                last_append: 0,
            });
            if seq <= p.last_seq && p.last_seq >= 0 {
                // duplicate retry of a chunk we already have
                return Ok(());
            }
            if !p.body.is_empty() {
                p.body.push(b',');
            }
            p.body.extend_from_slice(inner);
            p.events += n_events;
            p.first_ts = p.first_ts.min(first_ts);
            p.last_ts = p.last_ts.max(last_ts);
            p.last_seq = seq;
            p.last_append = crate::ids::now_ms();
            p.body.len() >= FLUSH_BYTES
        };
        index.apply_recording(project, session, distinct_id, inner.len() as i64, first_ts, last_ts, false);
        if flush_now {
            self.flush_one(&key, index).await?;
        }
        Ok(())
    }

    async fn next_object_index(&self, project: &str, session: &str) -> i64 {
        let prefix = format!("rec/p={project}/s={session}/");
        let mut max: i64 = -1;
        for f in self.store.list_local(&prefix) {
            if let Some(n) = f.key.rsplit('/').next().and_then(|n| n.strip_suffix(".json.gz")).and_then(|n| n.parse::<i64>().ok()) {
                max = max.max(n);
            }
        }
        if max < 0 {
            if let Ok(list) = self.store.list(&prefix).await {
                for f in list {
                    if let Some(n) = f.key.rsplit('/').next().and_then(|n| n.strip_suffix(".json.gz")).and_then(|n| n.parse::<i64>().ok()) {
                        max = max.max(n);
                    }
                }
            }
        }
        max + 1
    }

    async fn flush_one(&self, key: &str, index: &Index) -> Result<()> {
        let (project, session, distinct_id, body, first_ts, last_ts, next) = {
            let mut m = self.pending.lock();
            let p = match m.get_mut(key) {
                Some(p) if !p.body.is_empty() => p,
                _ => return Ok(()),
            };
            let body = std::mem::take(&mut p.body);
            p.events = 0;
            let next = p.next_object;
            (p.project.clone(), p.session.clone(), p.distinct_id.clone(), body, p.first_ts, p.last_ts, next)
        };
        let n = if next >= 0 { next } else { self.next_object_index(&project, &session).await };
        {
            let mut m = self.pending.lock();
            if let Some(p) = m.get_mut(key) {
                p.next_object = n + 1;
            }
        }
        let mut gz = flate2::write::GzEncoder::new(Vec::with_capacity(body.len() / 4), flate2::Compression::new(5));
        gz.write_all(b"[")?;
        gz.write_all(&body)?;
        gz.write_all(b"]")?;
        let bytes = gz.finish()?;
        let object_key = format!("rec/p={project}/s={session}/{n:06}.json.gz");
        self.store.put(&object_key, Bytes::from(bytes)).await?;
        index.apply_recording(&project, &session, &distinct_id, 0, first_ts, last_ts, true);
        Ok(())
    }

    /// Flush sessions idle for 30 s (timer) or everything (`all`, at shutdown).
    pub async fn flush_idle(&self, index: &Index, all: bool) -> Result<usize> {
        let now = crate::ids::now_ms();
        let keys: Vec<String> = {
            let mut m = self.pending.lock();
            let keys: Vec<String> = m.iter().filter(|(_, p)| !p.body.is_empty() && (all || now - p.last_append > IDLE_MS)).map(|(k, _)| k.clone()).collect();
            // forget sessions that have been idle for an hour and have nothing buffered
            m.retain(|_, p| !p.body.is_empty() || now - p.last_append < 3_600_000);
            keys
        };
        let mut n = 0;
        for k in keys {
            if let Err(e) = self.flush_one(&k, index).await {
                tracing::warn!("recording flush {k}: {e}");
            } else {
                n += 1;
            }
        }
        Ok(n)
    }

    pub fn pending_bytes(&self) -> usize {
        self.pending.lock().values().map(|p| p.body.len()).sum()
    }

    /// Every object of a session's recording, concatenated into one JSON array (uncompressed bytes).
    pub async fn load(&self, project: &str, session: &str) -> Result<Option<Vec<u8>>> {
        let prefix = format!("rec/p={project}/s={session}/");
        let mut keys: Vec<String> = self.store.list_local(&prefix).into_iter().map(|f| f.key).collect();
        if let Ok(remote) = self.store.list(&prefix).await {
            for f in remote {
                if !keys.contains(&f.key) {
                    keys.push(f.key);
                }
            }
        }
        keys.retain(|k| k.ends_with(".json.gz"));
        keys.sort();
        // whatever is still buffered for this session comes last
        let tail: Option<Vec<u8>> = self.pending.lock().get(&Self::key(project, session)).filter(|p| !p.body.is_empty()).map(|p| p.body.clone());
        if keys.is_empty() && tail.is_none() {
            return Ok(None);
        }
        let mut out = Vec::new();
        out.push(b'[');
        let mut first = true;
        for k in keys {
            if let Some(b) = self.store.get(&k).await? {
                let raw = tokio::task::spawn_blocking(move || -> Result<Vec<u8>> {
                    use std::io::Read;
                    let mut d = flate2::read::GzDecoder::new(&b[..]);
                    let mut v = Vec::with_capacity(b.len() * 6);
                    d.read_to_end(&mut v)?;
                    Ok(v)
                })
                .await??;
                let inner = raw.trim_ascii();
                let inner = inner.strip_prefix(b"[").and_then(|s| s.strip_suffix(b"]")).unwrap_or(inner);
                if inner.is_empty() {
                    continue;
                }
                if !first {
                    out.push(b',');
                }
                out.extend_from_slice(inner);
                first = false;
            }
        }
        if let Some(t) = tail {
            if !first {
                out.push(b',');
            }
            out.extend_from_slice(&t);
        }
        out.push(b']');
        Ok(Some(out))
    }

    /// Delete a session's recording objects (retention).
    pub async fn delete_session(&self, project: &str, session: &str) -> Result<usize> {
        let prefix = format!("rec/p={project}/s={session}/");
        let mut keys: Vec<String> = self.store.list_local(&prefix).into_iter().map(|f| f.key).collect();
        for f in self.store.list(&prefix).await.unwrap_or_default() {
            if !keys.contains(&f.key) {
                keys.push(f.key);
            }
        }
        let n = keys.len();
        for k in keys {
            self.store.delete(&k).await?;
        }
        Ok(n)
    }
}
