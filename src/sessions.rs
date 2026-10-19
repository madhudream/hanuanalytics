//! The session and person index: aggregated in memory as events arrive, written to HanuDB in one batch
//! every few seconds. The admin's Sessions, Replay and Persons pages read HanuDB (filters, sort, paging),
//! not the parquet files, so they are instant.
use crate::events::Event;
use crate::hanudb::{BatchOp, HanuDb};
use crate::ids::now_ms;
use crate::meta::{PERSONS, SESSIONS};
use anyhow::Result;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SessionDoc {
    #[serde(rename = "_id")]
    pub id: String,
    pub project_id: String,
    pub session_id: String,
    pub distinct_id: String,
    pub start: i64,
    pub end: i64,
    pub duration_s: i64,
    pub pageviews: i64,
    pub events: i64,
    pub clicks: i64,
    pub errors: i64,
    pub entry_path: String,
    pub exit_path: String,
    pub entry_url: String,
    pub country: String,
    pub region: String,
    pub city: String,
    pub browser: String,
    pub os: String,
    pub device: String,
    pub referrer_domain: String,
    pub source: String,
    pub medium: String,
    pub campaign: String,
    pub term: String,
    pub content: String,
    pub referrer: String,
    pub has_recording: bool,
    pub rec_chunks: i64,
    pub rec_bytes: i64,
    pub rec_duration_s: i64,
    pub rec_first_ts: i64,
    pub rec_last_ts: i64,
    pub updated: i64,
}

impl SessionDoc {
    pub fn public(&self) -> Value {
        let mut v = serde_json::to_value(self).unwrap_or(Value::Null);
        if let Value::Object(m) = &mut v {
            m.remove("_id");
            m.insert("id".into(), Value::String(self.id.clone()));
            m.insert("start".into(), Value::String(iso(self.start)));
            m.insert("end".into(), Value::String(iso(self.end)));
            m.remove("rec_first_ts");
            m.remove("rec_last_ts");
            m.remove("updated");
        }
        v
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PersonDoc {
    #[serde(rename = "_id")]
    pub id: String,
    pub project_id: String,
    pub distinct_id: String,
    #[serde(default)]
    pub props: Map<String, Value>,
    pub first_seen: i64,
    pub last_seen: i64,
    pub sessions: i64,
    pub is_identified: bool,
    #[serde(default)]
    pub anon_ids: Vec<String>,
    #[serde(default)]
    pub last_country: String,
    #[serde(default)]
    pub last_browser: String,
    #[serde(default)]
    pub last_os: String,
    #[serde(default)]
    pub last_device: String,
    pub updated: i64,
}

impl PersonDoc {
    pub fn public(&self) -> Value {
        serde_json::json!({
            "distinct_id": self.distinct_id, "props": self.props, "first_seen": iso(self.first_seen), "last_seen": iso(self.last_seen),
            "sessions": self.sessions, "is_identified": self.is_identified, "anon_ids": self.anon_ids,
            "last_country": self.last_country, "last_browser": self.last_browser, "last_os": self.last_os, "last_device": self.last_device,
        })
    }
}

pub fn iso(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms).map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)).unwrap_or_default()
}

struct Entry<T> {
    doc: T,
    dirty: bool,
    touched: i64,
}

pub struct Index {
    db: HanuDb,
    sessions: Mutex<HashMap<String, Entry<SessionDoc>>>,
    persons: Mutex<HashMap<String, Entry<PersonDoc>>>,
    /// ids we have looked up in HanuDB already (so a restart merges with stored docs once, not per event)
    known: Mutex<HashSet<String>>,
}

impl Index {
    pub fn new(db: HanuDb) -> Self {
        Index { db, sessions: Mutex::new(HashMap::new()), persons: Mutex::new(HashMap::new()), known: Mutex::new(HashSet::new()) }
    }

    pub fn session_key(project: &str, session: &str) -> String {
        format!("{project}:{session}")
    }

    /// Session attribution already known for this session (so later events inherit it).
    pub fn attribution(&self, project: &str, session: &str) -> Option<(String, String, String, String, String, String, String)> {
        let m = self.sessions.lock();
        m.get(&Self::session_key(project, session)).map(|e| {
            let d = &e.doc;
            (d.referrer.clone(), d.referrer_domain.clone(), d.source.clone(), d.medium.clone(), d.campaign.clone(), d.term.clone(), d.content.clone())
        })
    }

    pub fn knows_session(&self, project: &str, session: &str) -> bool {
        self.sessions.lock().contains_key(&Self::session_key(project, session))
    }

    /// Load a stored session into memory if it exists (after a restart). Returns true if found.
    pub async fn warm_session(&self, project: &str, session: &str) -> bool {
        let key = Self::session_key(project, session);
        if self.known.lock().contains(&key) {
            return self.sessions.lock().contains_key(&key);
        }
        {
            let mut k = self.known.lock();
            if k.len() > 200_000 {
                k.clear();
            }
            k.insert(key.clone());
        }
        if let Ok(Some(doc)) = self.db.get::<SessionDoc>(SESSIONS, &key).await {
            self.sessions.lock().entry(key).or_insert(Entry { doc, dirty: false, touched: now_ms() });
            return true;
        }
        false
    }

    pub async fn warm_person(&self, project: &str, distinct_id: &str) {
        let key = format!("{project}:{distinct_id}");
        let marker = format!("person/{key}");
        if self.known.lock().contains(&marker) {
            return;
        }
        self.known.lock().insert(marker);
        if let Ok(Some(doc)) = self.db.get::<PersonDoc>(PERSONS, &key).await {
            self.persons.lock().entry(key).or_insert(Entry { doc, dirty: false, touched: now_ms() });
        }
    }

    /// Fold one enriched event into its session and person.
    pub fn apply(&self, project: &str, e: &Event, set: Option<&Map<String, Value>>, set_once: Option<&Map<String, Value>>) {
        let now = now_ms();
        {
            let mut m = self.sessions.lock();
            let key = Self::session_key(project, &e.session_id);
            let entry = m.entry(key.clone()).or_insert_with(|| Entry {
                doc: SessionDoc {
                    id: key.clone(),
                    project_id: project.into(),
                    session_id: e.session_id.clone(),
                    distinct_id: e.distinct_id.clone(),
                    start: e.ts,
                    end: e.ts,
                    entry_path: e.path.clone(),
                    entry_url: e.url.clone(),
                    exit_path: e.path.clone(),
                    country: e.country.clone(),
                    region: e.region.clone(),
                    city: e.city.clone(),
                    browser: e.browser.clone(),
                    os: e.os.clone(),
                    device: e.device.clone(),
                    referrer_domain: e.referrer_domain.clone(),
                    referrer: e.referrer.clone(),
                    source: e.source.clone(),
                    medium: e.medium.clone(),
                    campaign: e.campaign.clone(),
                    term: e.term.clone(),
                    content: e.content.clone(),
                    ..Default::default()
                },
                dirty: true,
                touched: now,
            });
            let d = &mut entry.doc;
            if e.ts < d.start {
                d.start = e.ts;
                if e.event == "$pageview" && !e.path.is_empty() {
                    d.entry_path = e.path.clone();
                    d.entry_url = e.url.clone();
                }
            }
            if e.ts >= d.end {
                d.end = e.ts;
                if e.event == "$pageview" && !e.path.is_empty() {
                    d.exit_path = e.path.clone();
                }
            }
            if d.entry_path.is_empty() && !e.path.is_empty() {
                d.entry_path = e.path.clone();
                d.entry_url = e.url.clone();
            }
            d.duration_s = (d.end - d.start) / 1000;
            d.events += 1;
            match e.event.as_str() {
                "$pageview" => d.pageviews += 1,
                "$autocapture" => d.clicks += 1,
                "$exception" => d.errors += 1,
                _ => {}
            }
            if e.distinct_id != e.anon_id && !e.distinct_id.is_empty() {
                d.distinct_id = e.distinct_id.clone();
            }
            if d.country.is_empty() {
                d.country = e.country.clone();
                d.region = e.region.clone();
                d.city = e.city.clone();
            }
            if d.source.is_empty() && !e.source.is_empty() {
                d.source = e.source.clone();
                d.medium = e.medium.clone();
                d.campaign = e.campaign.clone();
                d.term = e.term.clone();
                d.content = e.content.clone();
                d.referrer = e.referrer.clone();
                d.referrer_domain = e.referrer_domain.clone();
            }
            d.updated = now;
            entry.dirty = true;
            entry.touched = now;
        }
        {
            let mut m = self.persons.lock();
            let key = format!("{project}:{}", e.distinct_id);
            let entry = m.entry(key.clone()).or_insert_with(|| Entry {
                doc: PersonDoc { id: key.clone(), project_id: project.into(), distinct_id: e.distinct_id.clone(), first_seen: e.ts, last_seen: e.ts, ..Default::default() },
                dirty: true,
                touched: now,
            });
            let d = &mut entry.doc;
            if e.ts < d.first_seen || d.first_seen == 0 {
                d.first_seen = e.ts;
            }
            if e.ts > d.last_seen {
                d.last_seen = e.ts;
                d.last_country = e.country.clone();
                d.last_browser = e.browser.clone();
                d.last_os = e.os.clone();
                d.last_device = e.device.clone();
            }
            if e.is_session_start {
                d.sessions += 1;
            }
            d.is_identified = d.is_identified || (e.distinct_id != e.anon_id && !e.anon_id.is_empty());
            if !e.anon_id.is_empty() && !d.anon_ids.contains(&e.anon_id) && d.anon_ids.len() < 20 {
                d.anon_ids.push(e.anon_id.clone());
            }
            if let Some(s) = set {
                for (k, v) in s {
                    if d.props.len() < 200 || d.props.contains_key(k) {
                        d.props.insert(k.clone(), v.clone());
                    }
                }
            }
            if let Some(s) = set_once {
                for (k, v) in s {
                    if !d.props.contains_key(k) && d.props.len() < 200 {
                        d.props.insert(k.clone(), v.clone());
                    }
                }
            }
            d.updated = now;
            entry.dirty = true;
            entry.touched = now;
        }
    }

    /// Recording progress for a session.
    pub fn apply_recording(&self, project: &str, session: &str, distinct_id: &str, bytes: i64, first_ts: i64, last_ts: i64, new_object: bool) {
        let mut m = self.sessions.lock();
        let key = Self::session_key(project, session);
        let now = now_ms();
        let entry = m.entry(key.clone()).or_insert_with(|| Entry {
            doc: SessionDoc { id: key.clone(), project_id: project.into(), session_id: session.into(), distinct_id: distinct_id.into(), start: first_ts, end: last_ts, ..Default::default() },
            dirty: true,
            touched: now,
        });
        let d = &mut entry.doc;
        d.has_recording = true;
        if new_object {
            d.rec_chunks += 1;
        }
        d.rec_bytes += bytes;
        if d.rec_first_ts == 0 || first_ts < d.rec_first_ts {
            d.rec_first_ts = first_ts;
        }
        if last_ts > d.rec_last_ts {
            d.rec_last_ts = last_ts;
        }
        d.rec_duration_s = (d.rec_last_ts - d.rec_first_ts).max(0) / 1000;
        if d.start == 0 || first_ts < d.start {
            d.start = first_ts;
        }
        if last_ts > d.end {
            d.end = last_ts;
            d.duration_s = (d.end - d.start) / 1000;
        }
        d.updated = now;
        entry.dirty = true;
        entry.touched = now;
    }

    /// Write every dirty doc to HanuDB in one batch; evict entries idle for two hours.
    pub async fn flush(&self) -> Result<usize> {
        let mut ops = vec![];
        let now = now_ms();
        {
            let mut m = self.sessions.lock();
            for (k, e) in m.iter_mut() {
                if e.dirty {
                    ops.push(HanuDb::put_op(SESSIONS, k, &e.doc));
                    e.dirty = false;
                }
            }
            m.retain(|_, e| now - e.touched < 2 * 3600 * 1000);
        }
        {
            let mut m = self.persons.lock();
            for (k, e) in m.iter_mut() {
                if e.dirty {
                    ops.push(HanuDb::put_op(PERSONS, k, &e.doc));
                    e.dirty = false;
                }
            }
            m.retain(|_, e| now - e.touched < 2 * 3600 * 1000);
        }
        let n = ops.len();
        if n == 0 {
            return Ok(0);
        }
        // write in slices so one batch stays well under HanuDB's body limit
        for chunk in ops.chunks(500) {
            let chunk: Vec<BatchOp> = chunk.iter().map(|op| match op {
                BatchOp::Put { col, id, doc } => BatchOp::Put { col: col.clone(), id: id.clone(), doc: doc.clone() },
                BatchOp::Delete { col, id } => BatchOp::Delete { col: col.clone(), id: id.clone() },
            }).collect();
            if let Err(e) = self.db.batch(chunk).await {
                // mark everything dirty again so the next flush retries
                for e2 in self.sessions.lock().values_mut() {
                    e2.dirty = true;
                }
                for e2 in self.persons.lock().values_mut() {
                    e2.dirty = true;
                }
                return Err(e);
            }
        }
        Ok(n)
    }

    pub fn pending(&self) -> usize {
        self.sessions.lock().values().filter(|e| e.dirty).count() + self.persons.lock().values().filter(|e| e.dirty).count()
    }
}
