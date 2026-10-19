//! A small HanuDB client (HTTP). Metadata, the session index and persons live in HanuDB; this server only
//! ever talks to one node on the same VM, so the client is deliberately simple: typed helpers over `_find`,
//! get/put/delete and `_batch`, with read-your-writes through `min_txn`.
use anyhow::{anyhow, Context, Result};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone)]
pub struct HanuDb {
    base: String,
    token: String,
    http: reqwest::Client,
    last_txn: Arc<AtomicU64>,
}

#[derive(Deserialize, Debug)]
pub struct WriteResult {
    pub id: String,
    pub txn: u64,
}

#[derive(Deserialize, Debug)]
pub struct BatchResult {
    pub ids: Vec<String>,
    pub txn: u64,
}

#[derive(Deserialize, Debug)]
pub struct FindResult<T> {
    pub hits: Vec<T>,
    pub total: Option<u64>,
    pub aggs: Option<Value>,
    pub took_us: Option<u64>,
}

#[derive(Serialize, Default, Debug, Clone)]
pub struct Find {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub q: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_txn: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wait_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aggs: Option<Value>,
}

impl Find {
    pub fn filter(f: Value) -> Self {
        Find { filter: Some(f), ..Default::default() }
    }
    pub fn sort(mut self, s: &str) -> Self {
        self.sort = Some(Value::String(s.into()));
        self
    }
    pub fn limit(mut self, n: usize) -> Self {
        self.limit = Some(n);
        self
    }
    pub fn offset(mut self, n: usize) -> Self {
        self.offset = Some(n);
        self
    }
    pub fn count(mut self) -> Self {
        self.count = Some(true);
        self
    }
}

#[derive(Serialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum BatchOp {
    Put { col: String, id: String, doc: Value },
    Delete { col: String, id: String },
}

impl HanuDb {
    pub fn new(base: &str, token: &str) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .pool_max_idle_per_host(8)
            .build()
            .expect("reqwest client");
        HanuDb { base: base.trim_end_matches('/').to_string(), token: token.to_string(), http, last_txn: Arc::new(AtomicU64::new(0)) }
    }

    pub fn url(&self) -> &str {
        &self.base
    }

    fn req(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let mut r = self.http.request(method, format!("{}{}", self.base, path));
        if !self.token.is_empty() {
            r = r.bearer_auth(&self.token);
        }
        r
    }

    fn track(&self, txn: u64) {
        self.last_txn.fetch_max(txn, Ordering::Relaxed);
    }

    async fn send<T: DeserializeOwned>(&self, r: reqwest::RequestBuilder) -> Result<Option<T>> {
        let res = r.send().await.context("hanudb unreachable")?;
        let status = res.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let body = res.bytes().await?;
        if !status.is_success() {
            let msg = serde_json::from_slice::<Value>(&body).ok().and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from));
            return Err(anyhow!("hanudb {}: {}", status, msg.unwrap_or_else(|| String::from_utf8_lossy(&body).to_string())));
        }
        Ok(Some(serde_json::from_slice(&body).with_context(|| format!("hanudb: bad json from {}", status))?))
    }

    pub async fn health(&self) -> bool {
        self.http.get(format!("{}/health", self.base)).send().await.map(|r| r.status().is_success()).unwrap_or(false)
    }

    pub async fn status(&self) -> Result<Value> {
        self.send::<Value>(self.req(reqwest::Method::GET, "/v1/_status")).await?.ok_or_else(|| anyhow!("no status"))
    }

    pub async fn get<T: DeserializeOwned>(&self, col: &str, id: &str) -> Result<Option<T>> {
        self.send(self.req(reqwest::Method::GET, &format!("/v1/{col}/{}", urlenc(id)))).await
    }

    pub async fn put(&self, col: &str, id: &str, doc: &Value) -> Result<WriteResult> {
        let r: WriteResult = self.send(self.req(reqwest::Method::PUT, &format!("/v1/{col}/{}", urlenc(id))).json(doc)).await?.ok_or_else(|| anyhow!("put: not found"))?;
        self.track(r.txn);
        Ok(r)
    }

    pub async fn put_t<T: Serialize>(&self, col: &str, id: &str, doc: &T) -> Result<WriteResult> {
        self.put(col, id, &serde_json::to_value(doc)?).await
    }

    pub async fn delete(&self, col: &str, id: &str) -> Result<()> {
        if let Some(r) = self.send::<WriteResult>(self.req(reqwest::Method::DELETE, &format!("/v1/{col}/{}", urlenc(id)))).await? {
            self.track(r.txn);
        }
        Ok(())
    }

    /// `_find` that always sees this process's own writes (read-your-writes via min_txn).
    pub async fn find<T: DeserializeOwned>(&self, col: &str, mut f: Find) -> Result<FindResult<T>> {
        let last = self.last_txn.load(Ordering::Relaxed);
        if f.min_txn.is_none() && last > 0 {
            f.min_txn = Some(last);
            f.wait_ms = Some(3000);
        }
        self.send(self.req(reqwest::Method::POST, &format!("/v1/{col}/_find")).json(&f)).await?.ok_or_else(|| anyhow!("find: not found"))
    }

    pub async fn find_one<T: DeserializeOwned>(&self, col: &str, filter: Value) -> Result<Option<T>> {
        let r: FindResult<T> = self.find(col, Find::filter(filter).limit(1)).await?;
        Ok(r.hits.into_iter().next())
    }

    pub async fn count(&self, col: &str) -> Result<u64> {
        let v: Value = self.send(self.req(reqwest::Method::GET, &format!("/v1/{col}/_count"))).await?.ok_or_else(|| anyhow!("count"))?;
        Ok(v.get("count").and_then(|c| c.as_u64()).unwrap_or(0))
    }

    pub async fn batch(&self, ops: Vec<BatchOp>) -> Result<BatchResult> {
        if ops.is_empty() {
            return Ok(BatchResult { ids: vec![], txn: self.last_txn.load(Ordering::Relaxed) });
        }
        let r: BatchResult = self.send(self.req(reqwest::Method::POST, "/v1/_batch").json(&ops)).await?.ok_or_else(|| anyhow!("batch"))?;
        self.track(r.txn);
        Ok(r)
    }

    pub fn put_op<T: Serialize>(col: &str, id: &str, doc: &T) -> BatchOp {
        BatchOp::Put { col: col.into(), id: id.into(), doc: serde_json::to_value(doc).unwrap_or(json!({})) }
    }
}

fn urlenc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}
