//! The last 30 minutes of events per project, in memory, for the Live view.
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};

#[derive(Clone, Serialize, Debug)]
pub struct LiveEvent {
    pub ts: i64,
    pub event: String,
    pub path: String,
    pub country: String,
    pub city: String,
    pub browser: String,
    pub device: String,
    pub distinct_id: String,
    pub session_id: String,
    #[serde(skip)]
    pub visitor: String,
}

const WINDOW_MS: i64 = 30 * 60 * 1000;
const CAP: usize = 5000;

#[derive(Default)]
pub struct Live {
    inner: Mutex<HashMap<String, VecDeque<LiveEvent>>>,
}

impl Live {
    pub fn push(&self, project: &str, e: LiveEvent) {
        let mut m = self.inner.lock();
        let q = m.entry(project.to_string()).or_default();
        q.push_back(e);
        let cutoff = crate::ids::now_ms() - WINDOW_MS;
        while q.len() > CAP || q.front().map(|f| f.ts < cutoff).unwrap_or(false) {
            q.pop_front();
        }
    }

    pub fn snapshot(&self, project: &str) -> Vec<LiveEvent> {
        let cutoff = crate::ids::now_ms() - WINDOW_MS;
        self.inner.lock().get(project).map(|q| q.iter().filter(|e| e.ts >= cutoff).cloned().collect()).unwrap_or_default()
    }

    pub fn total(&self) -> usize {
        self.inner.lock().values().map(|q| q.len()).sum()
    }

    pub fn forget(&self, project: &str) {
        self.inner.lock().remove(project);
    }
}
