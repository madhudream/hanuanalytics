//! "Continue with Google" (OpenID Connect, authorization-code flow). Works for the first-run setup, for
//! sign-in, for open registration and for accepting an invite sent to that Google address. Enabled when
//! HANU_GOOGLE_CLIENT_ID / HANU_GOOGLE_CLIENT_SECRET are set.
use crate::app::App;
use crate::auth;
use crate::ids;
use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use serde::Deserialize;
use serde_json::Value;

const STATE_COOKIE: &str = "hanu_oauth";

pub fn enabled(app: &App) -> bool {
    !app.cfg.google_client_id.is_empty() && !app.cfg.google_client_secret.is_empty()
}

fn redirect_uri(app: &App) -> String {
    format!("{}/api/admin/oauth/google/callback", app.cfg.public_url())
}

#[derive(Deserialize)]
pub struct StartQuery {
    #[serde(default)]
    next: String,
    /// an invite token, when the button sits on the invite page
    #[serde(default)]
    invite: String,
}

/// `GET /api/admin/oauth/google/start?next=/&invite=…`
pub async fn start(State(app): State<App>, Query(q): Query<StartQuery>) -> Response {
    if !enabled(&app) {
        return (StatusCode::NOT_FOUND, "Google sign-in is not configured").into_response();
    }
    let nonce = ids::random_hex(16);
    let next = if q.next.starts_with('/') && !q.next.starts_with("//") { q.next } else { "/".into() };
    let invite: String = q.invite.chars().filter(|c| c.is_ascii_alphanumeric()).take(60).collect();
    let state = format!("{nonce}|{next}|{invite}");
    let url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope=openid%20email%20profile&prompt=select_account&state={}",
        urlenc(&app.cfg.google_client_id),
        urlenc(&redirect_uri(&app)),
        urlenc(&state)
    );
    let mut h = HeaderMap::new();
    let secure = if app.cfg.cookie_secure() { "; Secure" } else { "" };
    h.insert(header::SET_COOKIE, HeaderValue::from_str(&format!("{STATE_COOKIE}={nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600{secure}")).unwrap());
    (h, Redirect::to(&url)).into_response()
}

#[derive(Deserialize)]
pub struct CallbackQuery {
    #[serde(default)]
    code: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    error: String,
}

fn fail(reason: &str) -> Response {
    Redirect::to(&format!("/login?error={}", urlenc(reason))).into_response()
}

/// `GET /api/admin/oauth/google/callback`
pub async fn callback(State(app): State<App>, Query(q): Query<CallbackQuery>, headers: HeaderMap) -> Response {
    if !enabled(&app) {
        return fail("google sign-in is not configured");
    }
    if !q.error.is_empty() {
        return fail("google sign-in was cancelled");
    }
    let nonce = cookie_from(&headers, STATE_COOKIE).unwrap_or_default();
    let mut st = q.state.splitn(3, '|');
    let (s_nonce, next, invite) = (st.next().unwrap_or(""), st.next().unwrap_or("/"), st.next().unwrap_or(""));
    if nonce.is_empty() || nonce != s_nonce {
        return fail("sign-in session expired, try again");
    }
    // code -> tokens
    let http = reqwest::Client::new();
    let body = format!(
        "code={}&client_id={}&client_secret={}&redirect_uri={}&grant_type=authorization_code",
        urlenc(&q.code),
        urlenc(&app.cfg.google_client_id),
        urlenc(&app.cfg.google_client_secret),
        urlenc(&redirect_uri(&app))
    );
    let tok: Value = match http
        .post("https://oauth2.googleapis.com/token")
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
    {
        Ok(r) => r.json().await.unwrap_or(Value::Null),
        Err(e) => {
            tracing::warn!("google token exchange: {e}");
            return fail("could not reach Google");
        }
    };
    let access = match tok.get("access_token").and_then(|v| v.as_str()) {
        Some(a) => a.to_string(),
        None => {
            tracing::warn!("google token response: {tok}");
            return fail("google did not accept the sign-in");
        }
    };
    let info: Value = match http.get("https://openidconnect.googleapis.com/v1/userinfo").bearer_auth(&access).send().await {
        Ok(r) => r.json().await.unwrap_or(Value::Null),
        Err(_) => return fail("could not read the Google profile"),
    };
    let email = info.get("email").and_then(|v| v.as_str()).unwrap_or("").trim().to_ascii_lowercase();
    let verified = info.get("email_verified").and_then(|v| v.as_bool()).unwrap_or(false);
    let name = info.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if email.is_empty() || !verified {
        return fail("google account has no verified email");
    }
    let name = if name.is_empty() { email.split('@').next().unwrap_or("").to_string() } else { name };

    // who is this?
    let existing = match app.meta.user_by_email(&email).await {
        Ok(u) => u,
        Err(e) => return fail(&e.to_string()),
    };
    let user = if let Some(u) = existing {
        u
    } else {
        let first = app.meta.user_count().await.unwrap_or(1) == 0;
        let invite_doc = if invite.is_empty() { None } else { app.meta.invite_by_token(invite).await.ok().flatten().filter(|i| i.email == email) };
        let open = app.meta.setting("signup_mode").await.ok().flatten().map(|m| m == "open").unwrap_or(false);
        if !(first || open || invite_doc.is_some()) {
            return fail("no account for this Google address; ask for an invite");
        }
        let u = match app.meta.create_user(&email, &name, "").await {
            Ok(u) => u,
            Err(e) => return fail(&e.to_string()),
        };
        if let Some(i) = invite_doc {
            let _ = app.meta.add_member(&i.org_id, &u.id, &i.role).await;
            let _ = app.meta.delete_invite(&i.id).await;
        } else {
            let _ = app.meta.create_org(if first { "My organization" } else { &name }, &u.id).await;
        }
        if first {
            let _ = app.meta.set_setting("instance_admin", &u.id).await;
            tracing::info!("instance admin created via Google: {email}");
        }
        u
    };
    // an existing user following an invite link joins that org
    if !invite.is_empty() {
        if let Ok(Some(i)) = app.meta.invite_by_token(invite).await {
            if i.email == user.email {
                let _ = app.meta.add_member(&i.org_id, &user.id, &i.role).await;
                let _ = app.meta.delete_invite(&i.id).await;
            }
        }
    }
    let token = match auth::issue_token(&app.jwt_secret, &user.id) {
        Ok(t) => t,
        Err(e) => return fail(&e.to_string()),
    };
    let mut h = HeaderMap::new();
    h.append(header::SET_COOKIE, HeaderValue::from_str(&auth::session_cookie(&token, app.cfg.cookie_secure())).unwrap());
    h.append(header::SET_COOKIE, HeaderValue::from_str(&format!("{STATE_COOKIE}=; Path=/; HttpOnly; Max-Age=0")).unwrap());
    (h, Redirect::to(next)).into_response()
}

fn cookie_from(headers: &HeaderMap, name: &str) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    raw.split(';').map(|kv| kv.trim()).find_map(|kv| kv.strip_prefix(name).and_then(|v| v.strip_prefix('=')).map(|v| v.trim().to_string()))
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
