//! The admin API: setup, auth, orgs, invites, projects, stats, live, sessions, persons, SQL, system.
use crate::app::{ApiError, ApiResult, App};
use crate::auth::{self, AuthUser};
use crate::hanudb::Find;
use crate::meta::{self, clean_domains, Member, Project, User};
use crate::query::{interval_for, parse_filters, resolve_period, StatsParams};
use crate::sessions::{PersonDoc, SessionDoc};
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

fn err(e: anyhow::Error) -> ApiError {
    ApiError::from(e)
}

fn with_cookie(app: &App, user: &User, body: Value) -> Result<Response, ApiError> {
    let token = auth::issue_token(&app.jwt_secret, &user.id).map_err(err)?;
    let mut h = HeaderMap::new();
    h.insert(header::SET_COOKIE, HeaderValue::from_str(&auth::session_cookie(&token, app.cfg.cookie_secure())).unwrap());
    Ok((StatusCode::OK, h, Json(body)).into_response())
}

async fn signup_mode(app: &App) -> String {
    app.meta.setting("signup_mode").await.ok().flatten().unwrap_or_else(|| "invite".into())
}

// ------------------------------------------------------------------ setup / auth
pub async fn setup_status(State(app): State<App>) -> ApiResult {
    let n = app.meta.user_count().await.map_err(err)?;
    Ok(Json(json!({"needs_setup": n == 0, "signup_open": signup_mode(&app).await == "open", "version": env!("CARGO_PKG_VERSION")})))
}

#[derive(Deserialize)]
pub struct SetupBody {
    email: String,
    password: String,
    name: String,
    org_name: String,
    #[serde(default)]
    project_name: String,
    #[serde(default)]
    domains: Vec<String>,
}

pub async fn setup(State(app): State<App>, Json(b): Json<SetupBody>) -> Result<Response, ApiError> {
    if app.meta.user_count().await.map_err(err)? > 0 {
        return Err(ApiError::conflict("already set up"));
    }
    validate_email(&b.email)?;
    auth::check_password_strength(&b.password).map_err(|e| ApiError::bad(e.to_string()))?;
    let user = app.meta.create_user(&b.email, &b.name, &auth::hash_password(&b.password).map_err(err)?).await.map_err(|e| ApiError::conflict(e.to_string()))?;
    let org = app.meta.create_org(if b.org_name.trim().is_empty() { "My organization" } else { &b.org_name }, &user.id).await.map_err(err)?;
    let project = app.meta.create_project(&org.id, if b.project_name.trim().is_empty() { "My website" } else { &b.project_name }, b.domains, None).await.map_err(err)?;
    app.meta.set_setting("instance_admin", &user.id).await.map_err(err)?;
    let _ = app.meta.refresh_projects().await;
    with_cookie(&app, &user, json!({"user": user.public(), "org": org_json(&org, "owner"), "project": project.public()}))
}

#[derive(Deserialize)]
pub struct RegisterBody {
    email: String,
    password: String,
    name: String,
    #[serde(default)]
    org_name: String,
}

/// Open registration (when `signup_mode` is "open"): anyone can create an account and their own org.
pub async fn register(State(app): State<App>, Json(b): Json<RegisterBody>) -> Result<Response, ApiError> {
    if signup_mode(&app).await != "open" {
        return Err(ApiError::forbidden("sign-up is by invitation only"));
    }
    validate_email(&b.email)?;
    auth::check_password_strength(&b.password).map_err(|e| ApiError::bad(e.to_string()))?;
    let user = app.meta.create_user(&b.email, &b.name, &auth::hash_password(&b.password).map_err(err)?).await.map_err(|e| ApiError::conflict(e.to_string()))?;
    let org = app.meta.create_org(if b.org_name.trim().is_empty() { &b.name } else { &b.org_name }, &user.id).await.map_err(err)?;
    with_cookie(&app, &user, json!({"user": user.public(), "org": org_json(&org, "owner")}))
}

#[derive(Deserialize)]
pub struct LoginBody {
    email: String,
    password: String,
}

pub async fn login(State(app): State<App>, headers: HeaderMap, Json(b): Json<LoginBody>) -> Result<Response, ApiError> {
    let ip = crate::ingest::client_ip(&app, &headers, None).map(|i| i.to_string()).unwrap_or_default();
    if !app.limiter.allow(&format!("{ip}|{}", b.email.to_ascii_lowercase())) {
        return Err(ApiError(StatusCode::TOO_MANY_REQUESTS, "too many attempts, try again in 10 minutes".into()));
    }
    let user = app.meta.user_by_email(&b.email).await.map_err(err)?;
    match user {
        Some(u) if auth::verify_password(&b.password, &u.pw_hash) => with_cookie(&app, &u, json!({"user": u.public()})),
        _ => Err(ApiError::unauthorized("wrong email or password")),
    }
}

pub async fn logout(State(app): State<App>) -> Response {
    let mut h = HeaderMap::new();
    h.insert(header::SET_COOKIE, HeaderValue::from_str(&auth::clear_cookie(app.cfg.cookie_secure())).unwrap());
    (StatusCode::OK, h, Json(json!({"ok": true}))).into_response()
}

fn org_json(o: &meta::Org, role: &str) -> Value {
    json!({"id": o.id, "name": o.name, "created_at": o.created_at, "role": role})
}

pub async fn me(State(app): State<App>, AuthUser(user): AuthUser) -> ApiResult {
    let members = app.meta.memberships(&user.id).await.map_err(err)?;
    let mut orgs = vec![];
    let mut projects = vec![];
    for m in &members {
        if let Some(o) = app.meta.org(&m.org_id).await.map_err(err)? {
            orgs.push(org_json(&o, &m.role));
            for p in app.meta.org_projects(&o.id).await.map_err(err)? {
                projects.push(p.public());
            }
        }
    }
    let admin = app.meta.setting("instance_admin").await.ok().flatten().map(|a| a == user.id).unwrap_or(false);
    Ok(Json(json!({"user": user.public(), "orgs": orgs, "projects": projects, "is_instance_admin": admin})))
}

#[derive(Deserialize)]
pub struct AccountBody {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    current_password: Option<String>,
}

pub async fn update_account(State(app): State<App>, AuthUser(mut user): AuthUser, Json(b): Json<AccountBody>) -> ApiResult {
    if let Some(n) = b.name {
        if !n.trim().is_empty() {
            user.name = n.trim().to_string();
        }
    }
    if let Some(pw) = b.password {
        let cur = b.current_password.unwrap_or_default();
        if !auth::verify_password(&cur, &user.pw_hash) {
            return Err(ApiError::unauthorized("current password is wrong"));
        }
        auth::check_password_strength(&pw).map_err(|e| ApiError::bad(e.to_string()))?;
        user.pw_hash = auth::hash_password(&pw).map_err(err)?;
    }
    app.meta.save_user(&user).await.map_err(err)?;
    app.user_cache.forget(&user.id);
    Ok(Json(json!({"user": user.public()})))
}

fn validate_email(e: &str) -> Result<(), ApiError> {
    let e = e.trim();
    if e.len() < 3 || !e.contains('@') || e.len() > 254 {
        return Err(ApiError::bad("invalid email"));
    }
    Ok(())
}

// ------------------------------------------------------------------ orgs & team
async fn require_member(app: &App, org: &str, user: &str) -> Result<Member, ApiError> {
    app.meta.member(org, user).await.map_err(err)?.ok_or_else(|| ApiError::forbidden("not a member of this organization"))
}

async fn require_admin(app: &App, org: &str, user: &str) -> Result<Member, ApiError> {
    let m = require_member(app, org, user).await?;
    if m.role != "owner" && m.role != "admin" {
        return Err(ApiError::forbidden("admin role required"));
    }
    Ok(m)
}

#[derive(Deserialize)]
pub struct NameBody {
    name: String,
}

pub async fn create_org(State(app): State<App>, AuthUser(user): AuthUser, Json(b): Json<NameBody>) -> ApiResult {
    if b.name.trim().is_empty() {
        return Err(ApiError::bad("name required"));
    }
    let o = app.meta.create_org(&b.name, &user.id).await.map_err(err)?;
    Ok(Json(org_json(&o, "owner")))
}

pub async fn update_org(State(app): State<App>, AuthUser(user): AuthUser, Path(org): Path<String>, Json(b): Json<NameBody>) -> ApiResult {
    let m = require_admin(&app, &org, &user.id).await?;
    let mut o = app.meta.org(&org).await.map_err(err)?.ok_or_else(|| ApiError::not_found("org"))?;
    o.name = b.name.trim().to_string();
    app.meta.save_org(&o).await.map_err(err)?;
    Ok(Json(org_json(&o, &m.role)))
}

pub async fn members(State(app): State<App>, AuthUser(user): AuthUser, Path(org): Path<String>) -> ApiResult {
    require_member(&app, &org, &user.id).await?;
    let mut out = vec![];
    for m in app.meta.org_members(&org).await.map_err(err)? {
        if let Some(u) = app.meta.user(&m.user_id).await.map_err(err)? {
            out.push(json!({"user_id": u.id, "email": u.email, "name": u.name, "role": m.role, "joined_at": m.joined_at}));
        }
    }
    let invites: Vec<Value> = app.meta.org_invites(&org).await.map_err(err)?.into_iter().map(|i| invite_json(&app, &i)).collect();
    Ok(Json(json!({"members": out, "invites": invites})))
}

fn invite_json(app: &App, i: &meta::Invite) -> Value {
    let base = if app.cfg.public_url().is_empty() { String::new() } else { app.cfg.public_url() };
    json!({"id": i.id, "email": i.email, "role": i.role, "created_at": i.created_at, "expires_at": i.expires_at, "url": format!("{base}/invite/{}", i.token)})
}

#[derive(Deserialize)]
pub struct InviteBody {
    email: String,
    #[serde(default = "default_role")]
    role: String,
}
fn default_role() -> String {
    "member".into()
}

pub async fn create_invite(State(app): State<App>, AuthUser(user): AuthUser, Path(org): Path<String>, Json(b): Json<InviteBody>) -> ApiResult {
    require_admin(&app, &org, &user.id).await?;
    validate_email(&b.email)?;
    if !["owner", "admin", "member"].contains(&b.role.as_str()) {
        return Err(ApiError::bad("role must be owner, admin or member"));
    }
    let i = app.meta.create_invite(&org, &b.email, &b.role, &user.id).await.map_err(err)?;
    Ok(Json(json!({"invite": invite_json(&app, &i)})))
}

pub async fn delete_invite(State(app): State<App>, AuthUser(user): AuthUser, Path((org, id)): Path<(String, String)>) -> ApiResult {
    require_admin(&app, &org, &user.id).await?;
    if let Some(i) = app.meta.invite(&id).await.map_err(err)? {
        if i.org_id == org {
            app.meta.delete_invite(&id).await.map_err(err)?;
        }
    }
    Ok(Json(json!({"ok": true})))
}

#[derive(Deserialize)]
pub struct RoleBody {
    role: String,
}

pub async fn update_member(State(app): State<App>, AuthUser(user): AuthUser, Path((org, uid)): Path<(String, String)>, Json(b): Json<RoleBody>) -> ApiResult {
    let me = require_admin(&app, &org, &user.id).await?;
    if b.role == "owner" && me.role != "owner" {
        return Err(ApiError::forbidden("only an owner can make owners"));
    }
    let mut m = app.meta.member(&org, &uid).await.map_err(err)?.ok_or_else(|| ApiError::not_found("member"))?;
    if m.role == "owner" && me.role != "owner" {
        return Err(ApiError::forbidden("only an owner can change an owner"));
    }
    m.role = b.role;
    app.meta.db.put_t(meta::MEMBERS, &m.id, &m).await.map_err(err)?;
    Ok(Json(json!({"ok": true})))
}

pub async fn remove_member(State(app): State<App>, AuthUser(user): AuthUser, Path((org, uid)): Path<(String, String)>) -> ApiResult {
    let me = require_admin(&app, &org, &user.id).await?;
    let target = app.meta.member(&org, &uid).await.map_err(err)?.ok_or_else(|| ApiError::not_found("member"))?;
    if target.role == "owner" {
        let owners = app.meta.org_members(&org).await.map_err(err)?.into_iter().filter(|m| m.role == "owner").count();
        if owners <= 1 {
            return Err(ApiError::bad("an organization needs at least one owner"));
        }
        if me.role != "owner" {
            return Err(ApiError::forbidden("only an owner can remove an owner"));
        }
    }
    app.meta.remove_member(&org, &uid).await.map_err(err)?;
    Ok(Json(json!({"ok": true})))
}

pub async fn invite_info(State(app): State<App>, Path(token): Path<String>) -> ApiResult {
    let i = app.meta.invite_by_token(&token).await.map_err(err)?.ok_or_else(|| ApiError::not_found("invite not found or expired"))?;
    let org = app.meta.org(&i.org_id).await.map_err(err)?.map(|o| o.name).unwrap_or_default();
    let by = app.meta.user(&i.invited_by).await.map_err(err)?.map(|u| u.name).unwrap_or_default();
    Ok(Json(json!({"org_name": org, "email": i.email, "invited_by": by, "role": i.role})))
}

#[derive(Deserialize)]
pub struct AcceptBody {
    #[serde(default)]
    name: String,
    #[serde(default)]
    password: String,
}

pub async fn accept_invite(State(app): State<App>, Path(token): Path<String>, Json(b): Json<AcceptBody>) -> Result<Response, ApiError> {
    let i = app.meta.invite_by_token(&token).await.map_err(err)?.ok_or_else(|| ApiError::not_found("invite not found or expired"))?;
    if chrono::DateTime::parse_from_rfc3339(&i.expires_at).map(|t| t < chrono::Utc::now()).unwrap_or(false) {
        return Err(ApiError::bad("invite expired"));
    }
    let user = match app.meta.user_by_email(&i.email).await.map_err(err)? {
        Some(u) => {
            // an existing account joins by proving the password
            if !auth::verify_password(&b.password, &u.pw_hash) {
                return Err(ApiError::unauthorized("an account with this email exists: enter its password to join"));
            }
            u
        }
        None => {
            auth::check_password_strength(&b.password).map_err(|e| ApiError::bad(e.to_string()))?;
            let name = if b.name.trim().is_empty() { i.email.split('@').next().unwrap_or("").to_string() } else { b.name.clone() };
            app.meta.create_user(&i.email, &name, &auth::hash_password(&b.password).map_err(err)?).await.map_err(|e| ApiError::conflict(e.to_string()))?
        }
    };
    app.meta.add_member(&i.org_id, &user.id, &i.role).await.map_err(err)?;
    app.meta.delete_invite(&i.id).await.map_err(err)?;
    with_cookie(&app, &user, json!({"user": user.public(), "org_id": i.org_id}))
}

// ------------------------------------------------------------------ projects
async fn project_for(app: &App, user: &str, id: &str) -> Result<(Project, Member), ApiError> {
    let p = app.meta.project(id).await.map_err(err)?.ok_or_else(|| ApiError::not_found("project not found"))?;
    let m = require_member(app, &p.org_id, user).await?;
    Ok((p, m))
}

#[derive(Deserialize)]
pub struct NewProject {
    name: String,
    #[serde(default)]
    domains: Vec<String>,
    #[serde(default)]
    timezone: Option<String>,
}

pub async fn create_project(State(app): State<App>, AuthUser(user): AuthUser, Path(org): Path<String>, Json(b): Json<NewProject>) -> ApiResult {
    require_admin(&app, &org, &user.id).await?;
    if b.name.trim().is_empty() {
        return Err(ApiError::bad("name required"));
    }
    let p = app.meta.create_project(&org, &b.name, b.domains, b.timezone).await.map_err(err)?;
    let _ = app.meta.refresh_projects().await;
    Ok(Json(p.public()))
}

pub async fn get_project(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>) -> ApiResult {
    let (p, _) = project_for(&app, &user.id, &id).await?;
    Ok(Json(p.public()))
}

#[derive(Deserialize, Default)]
pub struct PatchProject {
    name: Option<String>,
    domains: Option<Vec<String>>,
    allow_no_origin: Option<bool>,
    timezone: Option<String>,
    recording: Option<meta::RecordingConfig>,
    autocapture: Option<meta::AutocaptureConfig>,
    cookieless: Option<bool>,
    retention_days: Option<u32>,
    recording_retention_days: Option<u32>,
    session_timeout_ms: Option<u64>,
    respect_dnt: Option<bool>,
}

pub async fn patch_project(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>, Json(b): Json<PatchProject>) -> ApiResult {
    let (mut p, m) = project_for(&app, &user.id, &id).await?;
    if m.role == "member" {
        return Err(ApiError::forbidden("admin role required"));
    }
    if let Some(n) = b.name {
        if !n.trim().is_empty() {
            p.name = n.trim().to_string();
        }
    }
    if let Some(d) = b.domains {
        p.domains = clean_domains(d);
    }
    if let Some(v) = b.allow_no_origin {
        p.allow_no_origin = v;
    }
    if let Some(tz) = b.timezone {
        if tz.parse::<chrono_tz::Tz>().is_err() {
            return Err(ApiError::bad("unknown timezone"));
        }
        p.timezone = tz;
    }
    if let Some(mut r) = b.recording {
        r.sample_rate = r.sample_rate.clamp(0.0, 1.0);
        p.recording = r;
    }
    if let Some(a) = b.autocapture {
        p.autocapture = a;
    }
    if let Some(v) = b.cookieless {
        p.cookieless = v;
    }
    if let Some(v) = b.retention_days {
        p.retention_days = v.clamp(1, 3650);
    }
    if let Some(v) = b.recording_retention_days {
        p.recording_retention_days = v.clamp(1, 365);
    }
    if let Some(v) = b.session_timeout_ms {
        p.session_timeout_ms = v.clamp(60_000, 24 * 3600 * 1000);
    }
    if let Some(v) = b.respect_dnt {
        p.respect_dnt = v;
    }
    app.meta.save_project(&p).await.map_err(err)?;
    let _ = app.meta.refresh_projects().await;
    Ok(Json(p.public()))
}

pub async fn rotate_key(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>) -> ApiResult {
    let (mut p, m) = project_for(&app, &user.id, &id).await?;
    if m.role == "member" {
        return Err(ApiError::forbidden("admin role required"));
    }
    p.public_key = crate::ids::random_key("ha_pk_", 32);
    app.meta.save_project(&p).await.map_err(err)?;
    let _ = app.meta.refresh_projects().await;
    Ok(Json(p.public()))
}

pub async fn delete_project(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>) -> ApiResult {
    let (p, m) = project_for(&app, &user.id, &id).await?;
    if m.role == "member" {
        return Err(ApiError::forbidden("admin role required"));
    }
    app.meta.delete_project(&id).await.map_err(err)?;
    let _ = app.meta.refresh_projects().await;
    app.live.forget(&id);
    let app2 = app.clone();
    let pid = p.id.clone();
    tokio::spawn(async move {
        let _ = app2.buffer.delete_project(&pid).await;
        // sessions, persons and recordings of this project
        if let Ok(r) = app2.meta.db.find::<SessionDoc>(meta::SESSIONS, Find::filter(json!({"project_id": pid})).limit(10000)).await {
            for s in r.hits {
                let _ = app2.recordings.delete_session(&pid, &s.session_id).await;
                let _ = app2.meta.db.delete(meta::SESSIONS, &s.id).await;
            }
        }
        if let Ok(r) = app2.meta.db.find::<PersonDoc>(meta::PERSONS, Find::filter(json!({"project_id": pid})).limit(10000)).await {
            for p in r.hits {
                let _ = app2.meta.db.delete(meta::PERSONS, &p.id).await;
            }
        }
    });
    Ok(Json(json!({"ok": true})))
}

// ------------------------------------------------------------------ stats
fn earliest_day(app: &App, project: &str) -> Option<String> {
    app.store.catalog.read().days(project).first().map(|d| d.0.clone())
}

pub async fn overview(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>, Query(q): Query<StatsParams>) -> ApiResult {
    let (p, _) = project_for(&app, &user.id, &id).await?;
    let period = resolve_period(&q, &p.timezone, earliest_day(&app, &id)).map_err(|e| ApiError::bad(e.to_string()))?;
    let filters = parse_filters(&q.filters);
    let interval = interval_for(&period, q.interval.as_deref());
    let compare = q.compare.as_deref().map(|c| c == "1" || c == "true").unwrap_or(false);
    let mut v = app.query.overview(&id, &period, &filters, interval, compare).await.map_err(err)?;
    v["period"] = json!({"from": period.from.to_rfc3339(), "to": period.to.to_rfc3339(), "tz": period.tz.name()});
    Ok(Json(v))
}

pub async fn breakdown(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>, Query(q): Query<StatsParams>) -> ApiResult {
    let (p, _) = project_for(&app, &user.id, &id).await?;
    let period = resolve_period(&q, &p.timezone, earliest_day(&app, &id)).map_err(|e| ApiError::bad(e.to_string()))?;
    let filters = parse_filters(&q.filters);
    let by = q.by.clone().unwrap_or_else(|| "path".into());
    Ok(Json(app.query.breakdown(&id, &period, &filters, &by, q.limit.unwrap_or(10), q.offset.unwrap_or(0)).await.map_err(|e| ApiError::bad(e.to_string()))?))
}

pub async fn events_list(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>, Query(q): Query<StatsParams>) -> ApiResult {
    let (p, _) = project_for(&app, &user.id, &id).await?;
    let period = resolve_period(&q, &p.timezone, earliest_day(&app, &id)).map_err(|e| ApiError::bad(e.to_string()))?;
    Ok(Json(app.query.events_list(&id, &period, &parse_filters(&q.filters), q.limit.unwrap_or(50)).await.map_err(err)?))
}

pub async fn event_keys(State(app): State<App>, AuthUser(user): AuthUser, Path((id, event)): Path<(String, String)>, Query(q): Query<StatsParams>) -> ApiResult {
    let (p, _) = project_for(&app, &user.id, &id).await?;
    let period = resolve_period(&q, &p.timezone, earliest_day(&app, &id)).map_err(|e| ApiError::bad(e.to_string()))?;
    Ok(Json(app.query.event_keys(&id, &period, &event).await.map_err(err)?))
}

pub async fn event_props(State(app): State<App>, AuthUser(user): AuthUser, Path((id, event)): Path<(String, String)>, Query(q): Query<StatsParams>) -> ApiResult {
    let (p, _) = project_for(&app, &user.id, &id).await?;
    let period = resolve_period(&q, &p.timezone, earliest_day(&app, &id)).map_err(|e| ApiError::bad(e.to_string()))?;
    let key = q.key.clone().ok_or_else(|| ApiError::bad("key required"))?;
    Ok(Json(app.query.event_props(&id, &period, &parse_filters(&q.filters), &event, &key, q.limit.unwrap_or(20)).await.map_err(err)?))
}

pub async fn funnel(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>, Query(q): Query<StatsParams>) -> ApiResult {
    let (p, _) = project_for(&app, &user.id, &id).await?;
    let period = resolve_period(&q, &p.timezone, earliest_day(&app, &id)).map_err(|e| ApiError::bad(e.to_string()))?;
    let steps: Vec<String> = q.steps.clone().unwrap_or_default().split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    Ok(Json(app.query.funnel(&id, &period, &parse_filters(&q.filters), &steps, q.window_days.unwrap_or(7)).await.map_err(|e| ApiError::bad(e.to_string()))?))
}

pub async fn retention(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>) -> ApiResult {
    let (p, _) = project_for(&app, &user.id, &id).await?;
    let tz: chrono_tz::Tz = p.timezone.parse().unwrap_or(chrono_tz::UTC);
    Ok(Json(app.query.retention(&id, tz).await.map_err(err)?))
}

pub async fn errors(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>, Query(q): Query<StatsParams>) -> ApiResult {
    let (p, _) = project_for(&app, &user.id, &id).await?;
    let period = resolve_period(&q, &p.timezone, earliest_day(&app, &id)).map_err(|e| ApiError::bad(e.to_string()))?;
    Ok(Json(app.query.errors(&id, &period, &parse_filters(&q.filters), q.limit.unwrap_or(50)).await.map_err(err)?))
}

pub async fn vitals(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>, Query(q): Query<StatsParams>) -> ApiResult {
    let (p, _) = project_for(&app, &user.id, &id).await?;
    let period = resolve_period(&q, &p.timezone, earliest_day(&app, &id)).map_err(|e| ApiError::bad(e.to_string()))?;
    Ok(Json(app.query.vitals(&id, &period, &parse_filters(&q.filters)).await.map_err(err)?))
}

// ------------------------------------------------------------------ live
pub async fn live(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>) -> ApiResult {
    project_for(&app, &user.id, &id).await?;
    let now = crate::ids::now_ms();
    let events = app.live.snapshot(&id);
    let mut online = std::collections::HashSet::new();
    let mut pages: std::collections::HashMap<String, std::collections::HashSet<String>> = Default::default();
    let mut per_min: Vec<std::collections::HashSet<String>> = vec![Default::default(); 30];
    for e in &events {
        if now - e.ts <= 5 * 60_000 {
            online.insert(e.visitor.clone());
            if e.event == "$pageview" || e.event == "$pageleave" {
                pages.entry(e.path.clone()).or_default().insert(e.visitor.clone());
            }
        }
        let m = ((now - e.ts) / 60_000) as usize;
        if m < 30 {
            per_min[29 - m].insert(e.visitor.clone());
        }
    }
    let mut pages: Vec<(String, usize)> = pages.into_iter().map(|(k, v)| (k, v.len())).collect();
    pages.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let series: Vec<Value> = per_min
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let t = now - ((29 - i) as i64) * 60_000;
            let t = t - t % 60_000;
            json!({"t": crate::sessions::iso(t), "visitors": s.len()})
        })
        .collect();
    let latest: Vec<Value> = events.iter().rev().take(50).map(|e| json!({"ts": crate::sessions::iso(e.ts), "event": e.event, "path": e.path, "country": e.country, "city": e.city, "browser": e.browser, "device": e.device, "distinct_id": e.distinct_id, "session_id": e.session_id})).collect();
    Ok(Json(json!({"online": online.len(), "series": series, "pages": pages.into_iter().take(20).map(|(p, v)| json!({"path": p, "visitors": v})).collect::<Vec<_>>(), "events": latest})))
}

// ------------------------------------------------------------------ sessions & persons (HanuDB)
pub async fn sessions(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>, Query(q): Query<StatsParams>) -> ApiResult {
    let (p, _) = project_for(&app, &user.id, &id).await?;
    let period = resolve_period(&q, &p.timezone, earliest_day(&app, &id)).map_err(|e| ApiError::bad(e.to_string()))?;
    let mut filter = serde_json::Map::new();
    filter.insert("project_id".into(), json!(id));
    filter.insert("start".into(), json!({"$gte": period.from.timestamp_millis(), "$lt": period.to.timestamp_millis()}));
    if q.has_recording.as_deref().map(|v| v == "1" || v == "true").unwrap_or(false) {
        filter.insert("has_recording".into(), json!(true));
    }
    if let Some(d) = q.distinct_id.as_ref().filter(|d| !d.is_empty()) {
        filter.insert("distinct_id".into(), json!(d));
    }
    if let Some(c) = q.country.as_ref().filter(|c| !c.is_empty()) {
        filter.insert("country".into(), json!(c));
    }
    for f in parse_filters(&q.filters) {
        if ["browser", "os", "device", "country", "city", "region", "source", "entry_path", "exit_path", "referrer_domain"].contains(&f.key.as_str()) {
            match f.op.as_str() {
                "is_not" => filter.insert(f.key, json!({"$ne": f.value})),
                _ => filter.insert(f.key, json!(f.value)),
            };
        }
    }
    let sort = q.sort.clone().unwrap_or_else(|| "-start".into());
    let sort = if ["start", "-start", "duration_s", "-duration_s", "pageviews", "-pageviews", "events", "-events"].contains(&sort.as_str()) { sort } else { "-start".into() };
    let r = app.meta.db.find::<SessionDoc>(meta::SESSIONS, Find::filter(Value::Object(filter)).sort(&sort).limit(q.limit.unwrap_or(50).min(500)).offset(q.offset.unwrap_or(0)).count()).await.map_err(err)?;
    Ok(Json(json!({"rows": r.hits.iter().map(|s| s.public()).collect::<Vec<_>>(), "total": r.total.unwrap_or(r.hits.len() as u64)})))
}

pub async fn session(State(app): State<App>, AuthUser(user): AuthUser, Path((id, sid)): Path<(String, String)>) -> ApiResult {
    project_for(&app, &user.id, &id).await?;
    let s: SessionDoc = app.meta.db.get(meta::SESSIONS, &format!("{id}:{sid}")).await.map_err(err)?.ok_or_else(|| ApiError::not_found("session not found"))?;
    let events = app.query.session_events(&id, &sid, s.start, s.end).await.unwrap_or_default();
    Ok(Json(json!({"session": s.public(), "events": events})))
}

pub async fn session_recording(State(app): State<App>, AuthUser(user): AuthUser, Path((id, sid)): Path<(String, String)>) -> Result<Response, ApiError> {
    project_for(&app, &user.id, &id).await?;
    let sid: String = sid.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
    match app.recordings.load(&id, &sid).await.map_err(err)? {
        Some(bytes) => Ok(([(header::CONTENT_TYPE, "application/json"), (header::CACHE_CONTROL, "private, max-age=300")], bytes).into_response()),
        None => Err(ApiError::not_found("no recording for this session")),
    }
}

pub async fn persons(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>, Query(q): Query<StatsParams>) -> ApiResult {
    project_for(&app, &user.id, &id).await?;
    let mut f = Find::filter(json!({"project_id": id})).sort("-last_seen").limit(q.limit.unwrap_or(50).min(500)).offset(q.offset.unwrap_or(0)).count();
    if let Some(s) = q.q.as_ref().filter(|s| !s.trim().is_empty()) {
        f.q = Some(s.trim().to_string());
    }
    let r = app.meta.db.find::<PersonDoc>(meta::PERSONS, f).await.map_err(err)?;
    Ok(Json(json!({"rows": r.hits.iter().map(|p| p.public()).collect::<Vec<_>>(), "total": r.total.unwrap_or(r.hits.len() as u64)})))
}

pub async fn person(State(app): State<App>, AuthUser(user): AuthUser, Path((id, did)): Path<(String, String)>) -> ApiResult {
    project_for(&app, &user.id, &id).await?;
    let p: PersonDoc = app.meta.db.get(meta::PERSONS, &format!("{id}:{did}")).await.map_err(err)?.ok_or_else(|| ApiError::not_found("person not found"))?;
    let r = app.meta.db.find::<SessionDoc>(meta::SESSIONS, Find::filter(json!({"project_id": id, "distinct_id": did})).sort("-start").limit(100)).await.map_err(err)?;
    Ok(Json(json!({"person": p.public(), "sessions": r.hits.iter().map(|s| s.public()).collect::<Vec<_>>()})))
}

#[derive(Deserialize)]
pub struct SqlBody {
    sql: String,
    #[serde(default)]
    limit: Option<usize>,
}

pub async fn sql(State(app): State<App>, AuthUser(user): AuthUser, Path(id): Path<String>, Json(b): Json<SqlBody>) -> ApiResult {
    project_for(&app, &user.id, &id).await?;
    Ok(Json(app.query.sql(&id, &b.sql, b.limit.unwrap_or(1000)).await.map_err(|e| ApiError::bad(e.to_string()))?))
}

// ------------------------------------------------------------------ system
pub async fn system(State(app): State<App>, AuthUser(_user): AuthUser) -> ApiResult {
    let hanudb_ok = app.meta.db.health().await;
    let status = if hanudb_ok { app.meta.db.status().await.ok() } else { None };
    let (files, days) = {
        let c = app.store.catalog.read();
        (c.total_files(), c.events.values().map(|d| d.len()).sum::<usize>())
    };
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    let last_flush = {
        let t = app.buffer.last_flush_at.load(std::sync::atomic::Ordering::Relaxed);
        if t > 0 { Value::String(crate::sessions::iso(t)) } else { Value::Null }
    };
    Ok(Json(json!({
        "version": env!("CARGO_PKG_VERSION"), "node": app.node, "uptime_s": (crate::ids::now_ms() - app.started_at) / 1000,
        "hanudb": {"ok": hanudb_ok, "url": app.meta.db.url(), "status": status},
        "store": {"kind": app.store.kind, "url": app.store.remote_url, "ok": app.store.remote_ok().await, "uploads_ok": app.store.uploads_ok.load(std::sync::atomic::Ordering::Relaxed), "uploads_failed": app.store.uploads_failed.load(std::sync::atomic::Ordering::Relaxed)},
        "buffer": {"pending_events": app.buffer.pending(), "last_flush_at": last_flush,
                   "events_written": app.buffer.events_written.load(std::sync::atomic::Ordering::Relaxed), "index_pending": app.index.pending(), "recording_pending_bytes": app.recordings.pending_bytes()},
        "geo": {"loaded": app.geo.loaded(), "build": *app.geo.build.read(), "attribution": "IP geolocation by DB-IP (https://db-ip.com), CC BY 4.0"},
        "files": {"events": files, "event_days": days, "disk_used_bytes": app.store.disk_used()},
        "live": {"events_30m": app.live.total()},
        "memory": {"used_mb": sys.used_memory() / 1024 / 1024, "total_mb": sys.total_memory() / 1024 / 1024},
        "signup_mode": signup_mode(&app).await,
        "public_url": app.cfg.public_url(),
    })))
}

#[derive(Deserialize)]
pub struct SystemPatch {
    #[serde(default)]
    signup_mode: Option<String>,
}

pub async fn patch_system(State(app): State<App>, AuthUser(user): AuthUser, Json(b): Json<SystemPatch>) -> ApiResult {
    let admin = app.meta.setting("instance_admin").await.map_err(err)?;
    if admin.as_deref() != Some(user.id.as_str()) {
        return Err(ApiError::forbidden("instance admin only"));
    }
    if let Some(m) = b.signup_mode {
        if m != "open" && m != "invite" {
            return Err(ApiError::bad("signup_mode must be open or invite"));
        }
        app.meta.set_setting("signup_mode", &m).await.map_err(err)?;
    }
    Ok(Json(json!({"ok": true})))
}

pub async fn compact(State(app): State<App>, AuthUser(_user): AuthUser) -> ApiResult {
    let started = std::time::Instant::now();
    app.buffer.flush(true).await.map_err(err)?;
    let a = app.buffer.compact_recent().await.map_err(err)?;
    let b = app.buffer.compact_days().await.map_err(err)?;
    Ok(Json(json!({"merged_files": a + b, "ms": started.elapsed().as_millis() as u64})))
}
