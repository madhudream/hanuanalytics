//! Metadata models (users, orgs, members, invites, projects, settings) stored in HanuDB, plus an in-memory
//! cache of projects keyed by public key so the ingest path never waits on the database.
use crate::hanudb::{Find, HanuDb};
use crate::ids;
use anyhow::{anyhow, Result};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

pub const USERS: &str = "users";
pub const ORGS: &str = "orgs";
pub const MEMBERS: &str = "members";
pub const INVITES: &str = "invites";
pub const PROJECTS: &str = "projects";
pub const SETTINGS: &str = "settings";
pub const SESSIONS: &str = "sessions";
pub const PERSONS: &str = "persons";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct User {
    #[serde(rename = "_id")]
    pub id: String,
    pub email: String,
    pub name: String,
    #[serde(default)]
    pub pw_hash: String,
    pub created_at: String,
}

impl User {
    pub fn public(&self) -> Value {
        json!({"id": self.id, "email": self.email, "name": self.name, "created_at": self.created_at})
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Org {
    #[serde(rename = "_id")]
    pub id: String,
    pub name: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Member {
    #[serde(rename = "_id")]
    pub id: String, // org:user
    pub org_id: String,
    pub user_id: String,
    pub role: String, // owner | admin | member
    pub joined_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Invite {
    #[serde(rename = "_id")]
    pub id: String,
    pub org_id: String,
    pub email: String,
    pub role: String,
    pub token: String,
    pub invited_by: String,
    pub created_at: String,
    pub expires_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RecordingConfig {
    pub enabled: bool,
    pub sample_rate: f64,
    pub mask_all_inputs: bool,
    pub mask_text_selector: String,
    pub block_selector: String,
    pub min_duration_ms: u64,
}

impl Default for RecordingConfig {
    fn default() -> Self {
        RecordingConfig { enabled: true, sample_rate: 1.0, mask_all_inputs: true, mask_text_selector: String::new(), block_selector: String::new(), min_duration_ms: 0 }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct AutocaptureConfig {
    pub pageviews: bool,
    pub clicks: bool,
    pub forms: bool,
    pub errors: bool,
    pub vitals: bool,
    pub scroll: bool,
}

impl Default for AutocaptureConfig {
    fn default() -> Self {
        AutocaptureConfig { pageviews: true, clicks: true, forms: true, errors: true, vitals: true, scroll: true }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Project {
    #[serde(rename = "_id")]
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub public_key: String,
    #[serde(default)]
    pub domains: Vec<String>,
    #[serde(default)]
    pub allow_no_origin: bool,
    #[serde(default = "default_tz")]
    pub timezone: String,
    #[serde(default)]
    pub recording: RecordingConfig,
    #[serde(default)]
    pub autocapture: AutocaptureConfig,
    #[serde(default)]
    pub cookieless: bool,
    #[serde(default = "default_retention")]
    pub retention_days: u32,
    #[serde(default = "default_rec_retention")]
    pub recording_retention_days: u32,
    #[serde(default = "default_session_timeout")]
    pub session_timeout_ms: u64,
    #[serde(default)]
    pub respect_dnt: bool,
    pub created_at: String,
}

fn default_tz() -> String {
    "UTC".into()
}
fn default_retention() -> u32 {
    365
}
fn default_rec_retention() -> u32 {
    30
}
fn default_session_timeout() -> u64 {
    30 * 60 * 1000
}

impl Project {
    pub fn public(&self) -> Value {
        json!({
            "id": self.id, "org_id": self.org_id, "name": self.name, "public_key": self.public_key,
            "domains": self.domains, "allow_no_origin": self.allow_no_origin, "timezone": self.timezone,
            "recording": self.recording, "autocapture": self.autocapture, "cookieless": self.cookieless,
            "retention_days": self.retention_days, "recording_retention_days": self.recording_retention_days,
            "session_timeout_ms": self.session_timeout_ms, "respect_dnt": self.respect_dnt, "created_at": self.created_at
        })
    }

    pub fn sdk_config(&self) -> Value {
        json!({
            "ok": true, "project_id": self.id,
            "recording": self.recording, "autocapture": self.autocapture,
            "session_timeout_ms": self.session_timeout_ms, "cookieless": self.cookieless,
            "respect_dnt": self.respect_dnt, "server_time": ids::now_ms()
        })
    }

    /// Does an Origin / Referer host match this project's domains?
    pub fn allows_host(&self, host: &str) -> bool {
        let host = host.trim().to_ascii_lowercase();
        let host = host.split(':').next().unwrap_or("").to_string();
        if host.is_empty() {
            return false;
        }
        self.domains.iter().any(|d| domain_matches(d, &host))
    }
}

pub fn domain_matches(pattern: &str, host: &str) -> bool {
    let p = pattern.trim().to_ascii_lowercase();
    let p = p.trim_start_matches("https://").trim_start_matches("http://").trim_end_matches('/');
    let p = p.split(':').next().unwrap_or("");
    if p.is_empty() {
        return false;
    }
    if p == "*" {
        return true;
    }
    if let Some(suffix) = p.strip_prefix("*.") {
        return host == suffix || host.ends_with(&format!(".{suffix}"));
    }
    host == p || host == format!("www.{p}") || (p.starts_with("www.") && host == &p[4..])
}

#[derive(Clone)]
pub struct Meta {
    pub db: HanuDb,
    cache: Arc<RwLock<ProjectCache>>,
}

#[derive(Default)]
struct ProjectCache {
    by_key: HashMap<String, Arc<Project>>,
    by_id: HashMap<String, Arc<Project>>,
    loaded_at: i64,
}

impl Meta {
    pub fn new(db: HanuDb) -> Self {
        Meta { db, cache: Arc::new(RwLock::new(ProjectCache::default())) }
    }

    // ---- settings -------------------------------------------------------------------------
    pub async fn setting(&self, key: &str) -> Result<Option<String>> {
        let v: Option<Value> = self.db.get(SETTINGS, key).await?;
        Ok(v.and_then(|v| v.get("value").and_then(|s| s.as_str()).map(String::from)))
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.db.put(SETTINGS, key, &json!({"_id": key, "value": value})).await?;
        Ok(())
    }

    /// Returns the stored secret or creates one.
    pub async fn secret(&self, key: &str) -> Result<String> {
        if let Some(s) = self.setting(key).await? {
            if !s.is_empty() {
                return Ok(s);
            }
        }
        let s = ids::random_hex(32);
        self.set_setting(key, &s).await?;
        Ok(s)
    }

    // ---- users ----------------------------------------------------------------------------
    pub async fn user_count(&self) -> Result<u64> {
        // the index lags a write by one commit; count exact after writes is cheap at this size
        let r: crate::hanudb::FindResult<Value> = self.db.find(USERS, Find::default().limit(1).count()).await?;
        Ok(r.total.unwrap_or(r.hits.len() as u64))
    }

    pub async fn user_by_email(&self, email: &str) -> Result<Option<User>> {
        self.db.find_one(USERS, json!({"email": email.trim().to_ascii_lowercase()})).await
    }

    pub async fn user(&self, id: &str) -> Result<Option<User>> {
        self.db.get(USERS, id).await
    }

    pub async fn create_user(&self, email: &str, name: &str, pw_hash: &str) -> Result<User> {
        let email = email.trim().to_ascii_lowercase();
        if self.user_by_email(&email).await?.is_some() {
            return Err(anyhow!("an account with that email already exists"));
        }
        let u = User { id: ids::new_id("u"), email, name: name.trim().to_string(), pw_hash: pw_hash.into(), created_at: now_iso() };
        self.db.put_t(USERS, &u.id, &u).await?;
        Ok(u)
    }

    pub async fn save_user(&self, u: &User) -> Result<()> {
        self.db.put_t(USERS, &u.id, u).await?;
        Ok(())
    }

    // ---- orgs & members -------------------------------------------------------------------
    pub async fn create_org(&self, name: &str, owner: &str) -> Result<Org> {
        let o = Org { id: ids::new_id("o"), name: name.trim().to_string(), created_at: now_iso() };
        self.db.put_t(ORGS, &o.id, &o).await?;
        self.add_member(&o.id, owner, "owner").await?;
        Ok(o)
    }

    pub async fn org(&self, id: &str) -> Result<Option<Org>> {
        self.db.get(ORGS, id).await
    }

    pub async fn save_org(&self, o: &Org) -> Result<()> {
        self.db.put_t(ORGS, &o.id, o).await?;
        Ok(())
    }

    pub async fn add_member(&self, org: &str, user: &str, role: &str) -> Result<Member> {
        let m = Member { id: format!("{org}:{user}"), org_id: org.into(), user_id: user.into(), role: role.into(), joined_at: now_iso() };
        self.db.put_t(MEMBERS, &m.id, &m).await?;
        Ok(m)
    }

    pub async fn member(&self, org: &str, user: &str) -> Result<Option<Member>> {
        self.db.get(MEMBERS, &format!("{org}:{user}")).await
    }

    pub async fn remove_member(&self, org: &str, user: &str) -> Result<()> {
        self.db.delete(MEMBERS, &format!("{org}:{user}")).await
    }

    pub async fn memberships(&self, user: &str) -> Result<Vec<Member>> {
        Ok(self.db.find(MEMBERS, Find::filter(json!({"user_id": user})).limit(200)).await?.hits)
    }

    pub async fn org_members(&self, org: &str) -> Result<Vec<Member>> {
        Ok(self.db.find(MEMBERS, Find::filter(json!({"org_id": org})).limit(500)).await?.hits)
    }

    // ---- invites --------------------------------------------------------------------------
    pub async fn create_invite(&self, org: &str, email: &str, role: &str, by: &str) -> Result<Invite> {
        let i = Invite {
            id: ids::new_id("i"),
            org_id: org.into(),
            email: email.trim().to_ascii_lowercase(),
            role: role.into(),
            token: ids::random_key("", 40),
            invited_by: by.into(),
            created_at: now_iso(),
            expires_at: (chrono::Utc::now() + chrono::Duration::days(14)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        };
        self.db.put_t(INVITES, &i.id, &i).await?;
        Ok(i)
    }

    pub async fn invite_by_token(&self, token: &str) -> Result<Option<Invite>> {
        self.db.find_one(INVITES, json!({"token": token})).await
    }

    pub async fn org_invites(&self, org: &str) -> Result<Vec<Invite>> {
        Ok(self.db.find(INVITES, Find::filter(json!({"org_id": org})).limit(200)).await?.hits)
    }

    pub async fn invite(&self, id: &str) -> Result<Option<Invite>> {
        self.db.get(INVITES, id).await
    }

    pub async fn delete_invite(&self, id: &str) -> Result<()> {
        self.db.delete(INVITES, id).await
    }

    // ---- projects -------------------------------------------------------------------------
    pub async fn create_project(&self, org: &str, name: &str, domains: Vec<String>, timezone: Option<String>) -> Result<Project> {
        let p = Project {
            id: ids::new_id("p"),
            org_id: org.into(),
            name: name.trim().to_string(),
            public_key: ids::random_key("ha_pk_", 32),
            domains: clean_domains(domains),
            allow_no_origin: false,
            timezone: timezone.filter(|t| t.parse::<chrono_tz::Tz>().is_ok()).unwrap_or_else(default_tz),
            recording: RecordingConfig::default(),
            autocapture: AutocaptureConfig::default(),
            cookieless: false,
            retention_days: default_retention(),
            recording_retention_days: default_rec_retention(),
            session_timeout_ms: default_session_timeout(),
            respect_dnt: false,
            created_at: now_iso(),
        };
        self.db.put_t(PROJECTS, &p.id, &p).await?;
        self.invalidate();
        Ok(p)
    }

    pub async fn save_project(&self, p: &Project) -> Result<()> {
        self.db.put_t(PROJECTS, &p.id, p).await?;
        self.invalidate();
        Ok(())
    }

    pub async fn delete_project(&self, id: &str) -> Result<()> {
        self.db.delete(PROJECTS, id).await?;
        self.invalidate();
        Ok(())
    }

    pub async fn project(&self, id: &str) -> Result<Option<Project>> {
        if let Some(p) = self.cache.read().by_id.get(id).cloned() {
            return Ok(Some((*p).clone()));
        }
        self.db.get(PROJECTS, id).await
    }

    pub async fn org_projects(&self, org: &str) -> Result<Vec<Project>> {
        Ok(self.db.find(PROJECTS, Find::filter(json!({"org_id": org})).sort("created_at").limit(500)).await?.hits)
    }

    pub async fn all_projects(&self) -> Result<Vec<Project>> {
        Ok(self.db.find(PROJECTS, Find::default().limit(5000)).await?.hits)
    }

    pub fn invalidate(&self) {
        self.cache.write().loaded_at = 0;
    }

    /// Reload the project cache from HanuDB (called by a timer and after writes).
    pub async fn refresh_projects(&self) -> Result<usize> {
        let all = self.all_projects().await?;
        let mut c = self.cache.write();
        c.by_key.clear();
        c.by_id.clear();
        for p in all {
            let p = Arc::new(p);
            c.by_key.insert(p.public_key.clone(), p.clone());
            c.by_id.insert(p.id.clone(), p);
        }
        c.loaded_at = ids::now_ms();
        Ok(c.by_id.len())
    }

    pub fn cache_age_ms(&self) -> i64 {
        ids::now_ms() - self.cache.read().loaded_at
    }

    /// The hot path: a project by its public key, from memory.
    pub fn project_by_key(&self, key: &str) -> Option<Arc<Project>> {
        self.cache.read().by_key.get(key).cloned()
    }

    pub fn cached_project(&self, id: &str) -> Option<Arc<Project>> {
        self.cache.read().by_id.get(id).cloned()
    }

    pub fn cached_projects(&self) -> Vec<Arc<Project>> {
        self.cache.read().by_id.values().cloned().collect()
    }
}

pub fn clean_domains(domains: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = domains
        .into_iter()
        .map(|d| {
            let d = d.trim().to_ascii_lowercase();
            let d = d.trim_start_matches("https://").trim_start_matches("http://");
            d.split('/').next().unwrap_or("").to_string()
        })
        .filter(|d| !d.is_empty() && d.len() < 255)
        .collect();
    out.sort();
    out.dedup();
    out
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
