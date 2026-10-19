//! Access requests from the public landing page: stored in HanuDB, reviewed by the instance admin, approved
//! into an organization plus an invite link (sent by the admin by hand; this server sends no email).
use crate::app::{ApiError, ApiResult, App};
use crate::auth::AuthUser;
use crate::hanudb::Find;
use crate::ids;
use crate::meta::now_iso;
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::SocketAddr;

pub const REQUESTS: &str = "requests";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Request {
    #[serde(rename = "_id")]
    pub id: String,
    pub name: String,
    pub email: String,
    pub website: String,
    pub message: String,
    pub created_at: String,
    pub status: String,
    #[serde(default)]
    pub invite_url: String,
    #[serde(default)]
    pub org_id: String,
    #[serde(default)]
    pub decided_at: String,
    #[serde(default)]
    pub ip_hash: String,
}

impl Request {
    fn public(&self) -> Value {
        json!({"id": self.id, "name": self.name, "email": self.email, "website": self.website, "message": self.message, "created_at": self.created_at,
               "status": self.status, "invite_url": self.invite_url, "org_id": self.org_id, "decided_at": self.decided_at})
    }
}

#[derive(Deserialize)]
pub struct RequestBody {
    #[serde(default)]
    name: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    website: String,
    #[serde(default)]
    message: String,
    /// honeypot: real browsers leave it empty
    #[serde(default)]
    company_url: String,
}

/// `POST /api/public/request` — from the landing page.
pub async fn create(State(app): State<App>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, Json(b): Json<RequestBody>) -> ApiResult {
    if !b.company_url.is_empty() {
        return Ok(Json(json!({"ok": true})));
    }
    let email = b.email.trim().to_ascii_lowercase();
    if email.len() < 3 || !email.contains('@') || email.len() > 254 {
        return Err(ApiError::bad("a valid email is required"));
    }
    let name: String = b.name.trim().chars().take(120).collect();
    if name.is_empty() {
        return Err(ApiError::bad("your name is required"));
    }
    let ip = crate::ingest::client_ip(&app, &headers, Some(addr)).map(|i| i.to_string()).unwrap_or_default();
    if !app.limiter.allow(&format!("req|{ip}")) {
        return Err(ApiError(axum::http::StatusCode::TOO_MANY_REQUESTS, "too many requests, try again later".into()));
    }
    if let Some(existing) = app.meta.db.find_one::<Request>(REQUESTS, json!({"email": email})).await? {
        if existing.status == "new" {
            return Ok(Json(json!({"ok": true, "id": existing.id, "note": "already requested"})));
        }
    }
    let r = Request {
        id: ids::new_id("r"),
        name,
        email,
        website: b.website.trim().chars().take(200).collect(),
        message: b.message.trim().chars().take(2000).collect(),
        created_at: now_iso(),
        status: "new".into(),
        invite_url: String::new(),
        org_id: String::new(),
        decided_at: String::new(),
        ip_hash: {
            use sha2::Digest;
            hex::encode(sha2::Sha256::digest(format!("{}{ip}", app.salt)))[..16].to_string()
        },
    };
    app.meta.db.put_t(REQUESTS, &r.id, &r).await?;
    tracing::info!("access request from {} ({})", r.email, r.website);
    Ok(Json(json!({"ok": true, "id": r.id})))
}

async fn require_instance_admin(app: &App, user: &str) -> Result<(), ApiError> {
    match app.meta.setting("instance_admin").await? {
        Some(a) if a == user => Ok(()),
        _ => Err(ApiError::forbidden("instance admin only")),
    }
}

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    status: Option<String>,
}

pub async fn list(State(app): State<App>, AuthUser(user): AuthUser, Query(q): Query<ListQuery>) -> ApiResult {
    require_instance_admin(&app, &user.id).await?;
    let filter = match q.status.as_deref() {
        None | Some("all") | Some("") => json!({}),
        Some(s) => json!({"status": s}),
    };
    let r = app.meta.db.find::<Request>(REQUESTS, Find::filter(filter).sort("-created_at").limit(500)).await?;
    Ok(Json(json!({"rows": r.hits.iter().map(|x| x.public()).collect::<Vec<_>>()})))
}

pub async fn count_new(app: &App) -> u64 {
    app.meta.db.find::<Value>(REQUESTS, Find::filter(json!({"status": "new"})).limit(0).count()).await.ok().and_then(|r| r.total).unwrap_or(0)
}

#[derive(Deserialize, Default)]
pub struct ApproveBody {
    #[serde(default)]
    org_name: Option<String>,
}

pub async fn approve(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>, body: Option<Json<ApproveBody>>) -> ApiResult {
    require_instance_admin(&app, &user.id).await?;
    let mut r: Request = app.meta.db.get(REQUESTS, &id).await?.ok_or_else(|| ApiError::not_found("request"))?;
    if r.status == "approved" && !r.invite_url.is_empty() {
        return Ok(Json(json!({"request": r.public()})));
    }
    let b = body.map(|b| b.0).unwrap_or_default();
    let org_name = b
        .org_name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| {
            let host = r.website.trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("www.");
            let host = host.split('/').next().unwrap_or("").to_string();
            if host.is_empty() { r.name.clone() } else { host }
        });
    // the org is owned by the admin until the invitee accepts; they become an owner too
    let org = app.meta.create_org(&org_name, &user.id).await?;
    let invite = app.meta.create_invite(&org.id, &r.email, "owner", &user.id).await?;
    let base = app.cfg.public_url();
    r.invite_url = format!("{base}/invite/{}", invite.token);
    r.org_id = org.id.clone();
    r.status = "approved".into();
    r.decided_at = now_iso();
    app.meta.db.put_t(REQUESTS, &r.id, &r).await?;
    Ok(Json(json!({"request": r.public()})))
}

pub async fn reject(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>) -> ApiResult {
    require_instance_admin(&app, &user.id).await?;
    let mut r: Request = app.meta.db.get(REQUESTS, &id).await?.ok_or_else(|| ApiError::not_found("request"))?;
    r.status = "rejected".into();
    r.decided_at = now_iso();
    app.meta.db.put_t(REQUESTS, &r.id, &r).await?;
    Ok(Json(json!({"request": r.public()})))
}
