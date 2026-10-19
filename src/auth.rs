//! Passwords (argon2id), session cookies (JWT HS256), and the request extractor that turns a cookie into a user.
use crate::app::App;
use crate::meta::User;
use anyhow::{anyhow, Result};
use argon2::password_hash::{phc::PasswordHash, PasswordHasher, PasswordVerifier};
use argon2::Argon2;
use axum::extract::FromRequestParts;
use axum::http::{header, request::Parts, StatusCode};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const COOKIE: &str = "hanu_s";
const SESSION_DAYS: i64 = 30;

pub fn hash_password(pw: &str) -> Result<String> {
    Ok(Argon2::default().hash_password(pw.as_bytes()).map_err(|e| anyhow!("hash: {e}"))?.to_string())
}

pub fn verify_password(pw: &str, hash: &str) -> bool {
    if hash.is_empty() || pw.is_empty() {
        return false;
    }
    match PasswordHash::new(hash) {
        Ok(h) => Argon2::default().verify_password(pw.as_bytes(), &h).is_ok(),
        Err(_) => false,
    }
}

pub fn check_password_strength(pw: &str) -> Result<()> {
    if pw.chars().count() < 8 {
        return Err(anyhow!("password must be at least 8 characters"));
    }
    if pw.len() > 256 {
        return Err(anyhow!("password too long"));
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String,
    exp: i64,
    iat: i64,
}

pub fn issue_token(secret: &str, user_id: &str) -> Result<String> {
    let now = chrono::Utc::now().timestamp();
    let claims = Claims { sub: user_id.into(), iat: now, exp: now + SESSION_DAYS * 86400 };
    Ok(jsonwebtoken::encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_bytes()))?)
}

pub fn verify_token(secret: &str, token: &str) -> Option<String> {
    let v = Validation::default();
    jsonwebtoken::decode::<Claims>(token, &DecodingKey::from_secret(secret.as_bytes()), &v).ok().map(|d| d.claims.sub)
}

pub fn session_cookie(token: &str, secure: bool) -> String {
    format!("{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}", SESSION_DAYS * 86400, if secure { "; Secure" } else { "" })
}

pub fn clear_cookie(secure: bool) -> String {
    format!("{COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{}", if secure { "; Secure" } else { "" })
}

pub fn cookie_value(parts: &Parts, name: &str) -> Option<String> {
    let raw = parts.headers.get(header::COOKIE)?.to_str().ok()?;
    for kv in raw.split(';') {
        let kv = kv.trim();
        if let Some(v) = kv.strip_prefix(name) {
            if let Some(v) = v.strip_prefix('=') {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

/// A signed-in user. Fails the request with 401 otherwise.
pub struct AuthUser(pub User);

impl FromRequestParts<App> for AuthUser {
    type Rejection = (StatusCode, axum::Json<serde_json::Value>);

    async fn from_request_parts(parts: &mut Parts, app: &App) -> Result<Self, Self::Rejection> {
        let unauth = || (StatusCode::UNAUTHORIZED, axum::Json(serde_json::json!({"error": "not signed in"})));
        let token = cookie_value(parts, COOKIE).ok_or_else(unauth)?;
        let uid = verify_token(&app.jwt_secret, &token).ok_or_else(unauth)?;
        if let Some(u) = app.user_cache.get(&uid) {
            return Ok(AuthUser(u));
        }
        match app.meta.user(&uid).await {
            Ok(Some(u)) => {
                app.user_cache.put(u.clone());
                Ok(AuthUser(u))
            }
            _ => Err(unauth()),
        }
    }
}

/// Short-lived cache of users, so each admin request does not hit HanuDB.
pub struct UserCache {
    inner: Mutex<HashMap<String, (i64, User)>>,
}

impl UserCache {
    pub fn new() -> Self {
        UserCache { inner: Mutex::new(HashMap::new()) }
    }
    pub fn get(&self, id: &str) -> Option<User> {
        let m = self.inner.lock();
        m.get(id).filter(|(t, _)| crate::ids::now_ms() - t < 60_000).map(|(_, u)| u.clone())
    }
    pub fn put(&self, u: User) {
        let mut m = self.inner.lock();
        if m.len() > 1000 {
            m.clear();
        }
        m.insert(u.id.clone(), (crate::ids::now_ms(), u));
    }
    pub fn forget(&self, id: &str) {
        self.inner.lock().remove(id);
    }
}

/// Login rate limiting: at most 10 attempts per key per 10 minutes.
pub struct LoginLimiter {
    inner: Mutex<HashMap<String, (i64, u32)>>,
}

impl LoginLimiter {
    pub fn new() -> Self {
        LoginLimiter { inner: Mutex::new(HashMap::new()) }
    }
    pub fn allow(&self, key: &str) -> bool {
        let now = crate::ids::now_ms();
        let mut m = self.inner.lock();
        if m.len() > 10_000 {
            m.retain(|_, (t, _)| now - *t < 600_000);
        }
        let e = m.entry(key.to_string()).or_insert((now, 0));
        if now - e.0 > 600_000 {
            *e = (now, 0);
        }
        e.1 += 1;
        e.1 <= 10
    }
}
