//! The public API the SDK talks to: config, events, recording chunks. Every request carries a project public
//! key and is accepted only from the project's allowed domains.
use crate::app::App;
use crate::events::{classify_source, Event};
use crate::live::LiveEvent;
use crate::meta::Project;
use crate::ua;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

const MAX_EVENTS_BODY: usize = 1024 * 1024;
const MAX_REC_BODY: usize = 4 * 1024 * 1024;
const MAX_INFLATED: usize = 24 * 1024 * 1024;

#[derive(Deserialize)]
pub struct RawEvent {
    event: String,
    #[serde(default)]
    ts: Option<i64>,
    #[serde(default)]
    distinct_id: String,
    #[serde(default)]
    anon_id: String,
    #[serde(default)]
    session_id: String,
    #[serde(default)]
    props: Map<String, Value>,
    #[serde(default)]
    set: Option<Map<String, Value>>,
    #[serde(default)]
    set_once: Option<Map<String, Value>>,
}

#[derive(Deserialize)]
struct EventsBody {
    #[serde(default)]
    token: String,
    #[serde(default)]
    sent_at: Option<i64>,
    #[serde(default)]
    lib_version: String,
    #[serde(default)]
    events: Vec<RawEvent>,
}

#[derive(Deserialize)]
struct RecBody {
    #[serde(default)]
    token: String,
    session_id: String,
    #[serde(default)]
    distinct_id: String,
    #[serde(default)]
    seq: i64,
    #[serde(default)]
    events: Vec<Box<serde_json::value::RawValue>>,
}

#[derive(Deserialize)]
pub struct TokenQuery {
    #[serde(default)]
    token: String,
    #[serde(default)]
    t: String,
}

fn origin_host(headers: &HeaderMap) -> Option<String> {
    let v = headers.get(header::ORIGIN).or_else(|| headers.get(header::REFERER))?.to_str().ok()?;
    let u = url::Url::parse(v).ok()?;
    u.host_str().map(|h| h.to_string())
}

fn cors(headers: &HeaderMap) -> HeaderMap {
    let mut h = HeaderMap::new();
    if let Some(o) = headers.get(header::ORIGIN) {
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, o.clone());
        h.insert(header::VARY, HeaderValue::from_static("Origin"));
    }
    h
}

fn reply(headers: &HeaderMap, status: StatusCode, body: Value) -> Response {
    (status, cors(headers), Json(body)).into_response()
}

/// Preflight: reflect the origin; the real request still enforces the project's domain list.
pub async fn preflight(headers: HeaderMap) -> Response {
    let mut h = cors(&headers);
    h.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST, OPTIONS"));
    h.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("content-type, content-encoding"));
    h.insert(header::ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("86400"));
    (StatusCode::NO_CONTENT, h).into_response()
}

/// Token -> project, with the Origin / Referer check.
fn authorize(app: &App, token: &str, headers: &HeaderMap) -> Result<Arc<Project>, (StatusCode, &'static str)> {
    let p = app.meta.project_by_key(token.trim()).ok_or((StatusCode::UNAUTHORIZED, "invalid token"))?;
    match origin_host(headers) {
        Some(h) if p.allows_host(&h) => Ok(p),
        Some(_) => Err((StatusCode::FORBIDDEN, "origin not allowed")),
        None if p.allow_no_origin => Ok(p),
        None => Err((StatusCode::FORBIDDEN, "origin required")),
    }
}

pub async fn config(State(app): State<App>, Query(q): Query<TokenQuery>, headers: HeaderMap) -> Response {
    let token = if q.token.is_empty() { &q.t } else { &q.token };
    match authorize(&app, token, &headers) {
        Ok(p) => reply(&headers, StatusCode::OK, p.sdk_config()),
        Err((s, m)) => reply(&headers, s, json!({"ok": false, "error": m})),
    }
}

fn decode_body(headers: &HeaderMap, body: &Bytes, max: usize) -> Result<Vec<u8>, (StatusCode, &'static str)> {
    if body.len() > max {
        return Err((StatusCode::PAYLOAD_TOO_LARGE, "body too large"));
    }
    let gz = headers.get(header::CONTENT_ENCODING).and_then(|v| v.to_str().ok()).map(|v| v.contains("gzip")).unwrap_or(false) || body.starts_with(&[0x1f, 0x8b]);
    if gz {
        let mut d = flate2::read::GzDecoder::new(&body[..]).take(MAX_INFLATED as u64);
        let mut out = Vec::with_capacity(body.len() * 4);
        d.read_to_end(&mut out).map_err(|_| (StatusCode::BAD_REQUEST, "bad gzip"))?;
        Ok(out)
    } else {
        Ok(body.to_vec())
    }
}

pub fn client_ip(app: &App, headers: &HeaderMap, addr: Option<SocketAddr>) -> Option<IpAddr> {
    if app.cfg.trust_proxy {
        for h in ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"] {
            if let Some(v) = headers.get(h).and_then(|v| v.to_str().ok()) {
                if let Some(ip) = v.split(',').next().map(|s| s.trim()).and_then(|s| s.parse::<IpAddr>().ok()) {
                    return Some(ip);
                }
            }
        }
    }
    addr.map(|a| a.ip())
}

fn visitor_hash(salt: &str, day: &str, project: &str, ip: &str, ua: &str) -> String {
    let mut h = Sha256::new();
    h.update(salt.as_bytes());
    h.update(day.as_bytes());
    h.update(project.as_bytes());
    h.update(ip.as_bytes());
    h.update(ua.as_bytes());
    format!("v_{}", &hex::encode(h.finalize())[..20])
}

fn s(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.chars().take(2048).collect(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

fn i(v: Option<&Value>) -> i32 {
    v.and_then(|v| v.as_f64()).map(|f| f.clamp(-2.0e9, 2.0e9) as i32).unwrap_or(0)
}

fn b(v: Option<&Value>) -> bool {
    v.and_then(|v| v.as_bool()).unwrap_or(false)
}

pub struct Enricher<'a> {
    pub app: &'a App,
    pub project: &'a Project,
    pub ip: Option<IpAddr>,
    pub ua: ua::Ua,
    pub ua_raw: String,
    pub offset_ms: i64,
    pub lib_version: String,
    pub day: String,
    pub now: i64,
}

impl<'a> Enricher<'a> {
    pub fn enrich(&self, raw: RawEvent, geo: &crate::geo::GeoResult) -> Option<(Event, Option<Map<String, Value>>, Option<Map<String, Value>>)> {
        let mut props = raw.props;
        let ts = raw.ts.map(|t| t + self.offset_ms).unwrap_or(self.now).clamp(self.now - 90 * 86_400_000, self.now + 60_000);
        let mut e = Event { ts, lib_version: self.lib_version.clone(), ..Default::default() };
        e.event = raw.event.chars().take(200).collect();
        if e.event.is_empty() {
            return None;
        }
        e.anon_id = raw.anon_id.chars().take(100).collect();
        e.session_id = raw.session_id.chars().take(100).collect();
        e.distinct_id = if raw.distinct_id.is_empty() { e.anon_id.clone() } else { raw.distinct_id.chars().take(200).collect() };
        let ip_s = self.ip.map(|ip| ip.to_string()).unwrap_or_default();
        if e.session_id.is_empty() {
            e.session_id = visitor_hash(&self.app.salt, &self.day, &self.project.id, &ip_s, &self.ua_raw).replace("v_", "s_");
        }
        e.visitor = if !e.anon_id.is_empty() && !self.project.cookieless {
            e.anon_id.clone()
        } else {
            visitor_hash(&self.app.salt, &self.day, &self.project.id, &ip_s, &self.ua_raw)
        };
        if e.distinct_id.is_empty() {
            e.distinct_id = e.visitor.clone();
        }
        // url
        e.url = s(props.remove("$current_url").as_ref());
        if let Ok(u) = url::Url::parse(&e.url) {
            e.host = u.host_str().unwrap_or("").to_string();
            e.path = u.path().to_string();
            for (k, v) in u.query_pairs() {
                match k.as_ref() {
                    "utm_source" => e.source = v.chars().take(200).collect(),
                    "utm_medium" => e.medium = v.chars().take(200).collect(),
                    "utm_campaign" => e.campaign = v.chars().take(200).collect(),
                    "utm_term" => e.term = v.chars().take(200).collect(),
                    "utm_content" => e.content = v.chars().take(200).collect(),
                    "ref" | "source" if e.source.is_empty() => e.source = v.chars().take(200).collect(),
                    _ => {}
                }
            }
            if e.url.len() > 2048 {
                e.url.truncate(2048);
            }
        }
        e.title = s(props.remove("$title").as_ref()).chars().take(300).collect();
        // referrer (internal navigation is not a referrer)
        let referrer = s(props.remove("$referrer").as_ref());
        if let Ok(r) = url::Url::parse(&referrer) {
            let rh = r.host_str().unwrap_or("").to_string();
            if !rh.is_empty() && rh != e.host && !(rh.trim_start_matches("www.") == e.host.trim_start_matches("www.")) {
                e.referrer = referrer.chars().take(1024).collect();
                e.referrer_domain = rh.trim_start_matches("www.").to_string();
            }
        }
        // session-level attribution: inherit what the session already has
        if let Some((r, rd, src, med, camp, term, cont)) = self.app.index.attribution(&self.project.id, &e.session_id) {
            if e.referrer.is_empty() && e.referrer_domain.is_empty() {
                e.referrer = r;
                e.referrer_domain = rd;
            }
            if e.source.is_empty() && !src.is_empty() {
                e.source = src;
                e.medium = med;
                e.campaign = camp;
                e.term = term;
                e.content = cont;
            }
        }
        if e.source.is_empty() {
            e.source = classify_source(&e.referrer_domain);
        }
        if e.medium.is_empty() {
            e.medium = if e.referrer_domain.is_empty() && e.campaign.is_empty() { "(none)".into() } else if !e.referrer_domain.is_empty() { "referral".into() } else { String::new() };
        }
        e.country = geo.country.clone();
        e.region = geo.region.clone();
        e.city = geo.city.clone();
        e.browser = self.ua.browser.clone();
        e.browser_version = self.ua.browser_version.clone();
        e.os = self.ua.os.clone();
        e.os_version = self.ua.os_version.clone();
        e.device = self.ua.device.clone();
        e.screen_w = i(props.remove("$screen_width").as_ref());
        e.screen_h = i(props.remove("$screen_height").as_ref());
        e.viewport_w = i(props.remove("$viewport_width").as_ref());
        e.viewport_h = i(props.remove("$viewport_height").as_ref());
        e.language = s(props.remove("$language").as_ref()).chars().take(20).collect();
        e.timezone = s(props.remove("$timezone").as_ref()).chars().take(64).collect();
        e.is_new_visitor = b(props.remove("$is_new_visitor").as_ref());
        e.is_session_start = b(props.remove("$session_start").as_ref());
        e.duration_ms = i(props.get("$duration_ms"));
        e.scroll_depth = i(props.get("$scroll_depth"));
        props.remove("$lib_version");
        props.remove("$lib");
        // the rest stays as JSON (bounded)
        if !props.is_empty() {
            let mut p = serde_json::to_string(&props).unwrap_or_default();
            if p.len() > 16 * 1024 {
                let mut keep = Map::new();
                for (k, v) in props.into_iter() {
                    if keep.len() > 50 {
                        break;
                    }
                    let short = match v {
                        Value::String(s) => Value::String(s.chars().take(1000).collect()),
                        other => other,
                    };
                    keep.insert(k, short);
                }
                p = serde_json::to_string(&keep).unwrap_or_default();
                p.truncate(16 * 1024);
            }
            e.props = p;
        }
        Some((e, raw.set, raw.set_once))
    }
}

pub async fn events(State(app): State<App>, Query(q): Query<TokenQuery>, ConnectInfo(addr): ConnectInfo<SocketAddr>, headers: HeaderMap, body: Bytes) -> Response {
    let raw = match decode_body(&headers, &body, MAX_EVENTS_BODY) {
        Ok(r) => r,
        Err((s, m)) => return reply(&headers, s, json!({"ok": false, "error": m})),
    };
    let parsed: EventsBody = match serde_json::from_slice(&raw) {
        Ok(p) => p,
        Err(e) => return reply(&headers, StatusCode::BAD_REQUEST, json!({"ok": false, "error": format!("bad json: {e}")})),
    };
    let token = if !parsed.token.is_empty() { parsed.token.clone() } else if !q.token.is_empty() { q.token.clone() } else { q.t.clone() };
    let project = match authorize(&app, &token, &headers) {
        Ok(p) => p,
        Err((s, m)) => return reply(&headers, s, json!({"ok": false, "error": m})),
    };
    let ua_raw = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let parsed_ua = ua::parse(&ua_raw);
    if parsed_ua.device == "bot" {
        return reply(&headers, StatusCode::OK, json!({"ok": true, "accepted": 0}));
    }
    if parsed.events.len() > 500 {
        return reply(&headers, StatusCode::BAD_REQUEST, json!({"ok": false, "error": "too many events in one batch"}));
    }
    let now = crate::ids::now_ms();
    let offset = parsed.sent_at.map(|s| now - s).filter(|o| o.abs() < 86_400_000).unwrap_or(0);
    let ip = client_ip(&app, &headers, Some(addr));
    let geo = ip.map(|ip| app.geo.lookup(ip)).unwrap_or_default();
    let enricher = Enricher {
        app: &app,
        project: &project,
        ip,
        ua: parsed_ua,
        ua_raw,
        offset_ms: offset,
        lib_version: parsed.lib_version.chars().take(20).collect(),
        day: chrono::Utc::now().format("%Y-%m-%d").to_string(),
        now,
    };
    let mut out = Vec::with_capacity(parsed.events.len());
    for raw in parsed.events {
        let session_id = raw.session_id.clone();
        if let Some((mut e, set, set_once)) = enricher.enrich(raw, &geo) {
            // a session we have never seen: after a restart it may be in HanuDB
            if !e.is_session_start && !app.index.knows_session(&project.id, &e.session_id) {
                let known = app.index.warm_session(&project.id, &session_id).await;
                if !known {
                    e.is_session_start = true;
                }
            }
            if e.distinct_id != e.anon_id || set.is_some() || set_once.is_some() {
                app.index.warm_person(&project.id, &e.distinct_id).await;
            }
            app.index.apply(&project.id, &e, set.as_ref(), set_once.as_ref());
            app.live.push(
                &project.id,
                LiveEvent {
                    ts: e.ts,
                    event: e.event.clone(),
                    path: e.path.clone(),
                    country: e.country.clone(),
                    city: e.city.clone(),
                    browser: e.browser.clone(),
                    device: e.device.clone(),
                    distinct_id: e.distinct_id.clone(),
                    session_id: e.session_id.clone(),
                    visitor: e.visitor.clone(),
                },
            );
            out.push(e);
        }
    }
    let n = out.len();
    if n > 0 && app.buffer.push(&project.id, out) {
        let app2 = app.clone();
        let pid = project.id.clone();
        tokio::spawn(async move {
            if let Err(e) = app2.buffer.flush_project(&pid).await {
                tracing::error!("flush: {e:#}");
            }
        });
    }
    reply(&headers, StatusCode::OK, json!({"ok": true, "accepted": n}))
}

#[derive(Deserialize)]
struct RrTs {
    #[serde(default)]
    timestamp: i64,
}

pub async fn recording(State(app): State<App>, Query(q): Query<TokenQuery>, headers: HeaderMap, body: Bytes) -> Response {
    let raw = match decode_body(&headers, &body, MAX_REC_BODY) {
        Ok(r) => r,
        Err((s, m)) => return reply(&headers, s, json!({"ok": false, "error": m})),
    };
    let parsed: RecBody = match serde_json::from_slice(&raw) {
        Ok(p) => p,
        Err(e) => return reply(&headers, StatusCode::BAD_REQUEST, json!({"ok": false, "error": format!("bad json: {e}")})),
    };
    let token = if !parsed.token.is_empty() { parsed.token.clone() } else if !q.token.is_empty() { q.token.clone() } else { q.t.clone() };
    let project = match authorize(&app, &token, &headers) {
        Ok(p) => p,
        Err((s, m)) => return reply(&headers, s, json!({"ok": false, "error": m})),
    };
    if !project.recording.enabled {
        return reply(&headers, StatusCode::OK, json!({"ok": true, "ignored": "recording disabled"}));
    }
    if parsed.events.is_empty() || parsed.session_id.is_empty() {
        return reply(&headers, StatusCode::OK, json!({"ok": true}));
    }
    let first = serde_json::from_str::<RrTs>(parsed.events.first().unwrap().get()).map(|t| t.timestamp).unwrap_or(0);
    let last = serde_json::from_str::<RrTs>(parsed.events.last().unwrap().get()).map(|t| t.timestamp).unwrap_or(first);
    let now = crate::ids::now_ms();
    let first = if first > 0 { first } else { now };
    let last = if last > 0 { last } else { now };
    let mut joined = Vec::with_capacity(raw.len());
    joined.push(b'[');
    for (i, ev) in parsed.events.iter().enumerate() {
        if i > 0 {
            joined.push(b',');
        }
        joined.extend_from_slice(ev.get().as_bytes());
    }
    joined.push(b']');
    let sid: String = parsed.session_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').take(100).collect();
    let did: String = parsed.distinct_id.chars().take(200).collect();
    if let Err(e) = app.recordings.append(&project.id, &sid, &did, parsed.seq, &joined, first, last, parsed.events.len(), &app.index).await {
        tracing::error!("recording append: {e:#}");
        return reply(&headers, StatusCode::INTERNAL_SERVER_ERROR, json!({"ok": false, "error": "storage error"}));
    }
    reply(&headers, StatusCode::OK, json!({"ok": true}))
}
