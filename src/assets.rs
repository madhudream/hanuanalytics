//! The admin app and the SDK are compiled into the binary (release) or read from disk (debug builds), so one
//! file deploys the whole product.
use axum::body::Body;
use axum::extract::Path;
use axum::http::{header, HeaderValue, Request, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "admin/dist/"]
struct Admin;

#[derive(Embed)]
#[folder = "sdk/dist/"]
#[include = "*.js"]
struct Sdk;

#[derive(Embed)]
#[folder = "site/"]
struct Site;

fn etag(bytes: &[u8]) -> String {
    use sha2::Digest;
    let h = sha2::Sha256::digest(bytes);
    format!("\"{}\"", &hex::encode(h)[..16])
}

fn serve(bytes: Vec<u8>, path: &str, cache: &'static str, req_etag: Option<&HeaderValue>) -> Response {
    let tag = etag(&bytes);
    if req_etag.and_then(|v| v.to_str().ok()).map(|v| v == tag).unwrap_or(false) {
        return StatusCode::NOT_MODIFIED.into_response();
    }
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut res = Response::new(Body::from(bytes));
    res.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_str(mime.as_ref()).unwrap());
    res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    res.headers_mut().insert(header::ETAG, HeaderValue::from_str(&tag).unwrap());
    res
}

/// `/hanu.js`, `/hanu-rec.js`, `/hanu.esm.js`
pub async fn sdk(Path(file): Path<String>, req: Request<Body>) -> Response {
    match Sdk::get(&file) {
        Some(f) => serve(f.data.into_owned(), &file, "public, max-age=3600, stale-while-revalidate=86400", req.headers().get(header::IF_NONE_MATCH)),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// Everything that is not an API route: the admin SPA (assets or index.html fallback).
pub async fn admin(uri: Uri, req: Request<Body>) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    if let Some(f) = Admin::get(path) {
        let cache = if path.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
        return serve(f.data.into_owned(), path, cache, req.headers().get(header::IF_NONE_MATCH));
    }
    if path.contains('.') && !path.ends_with(".html") {
        return StatusCode::NOT_FOUND.into_response();
    }
    match Admin::get("index.html") {
        Some(f) => serve(f.data.into_owned(), "index.html", "no-cache", None),
        None => (StatusCode::SERVICE_UNAVAILABLE, "admin app not built (run scripts/build.sh)").into_response(),
    }
}

/// `/`: the product home page for visitors, the admin app for anyone with a session cookie.
pub async fn root(axum::extract::State(app): axum::extract::State<crate::app::App>, uri: Uri, req: Request<Body>) -> Response {
    let signed_in = req
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|raw| raw.split(';').map(|kv| kv.trim()).find_map(|kv| kv.strip_prefix("hanu_s=")))
        .map(|t| crate::auth::verify_token(&app.jwt_secret, t).is_some())
        .unwrap_or(false);
    if signed_in {
        admin(uri, req).await
    } else {
        home(req).await
    }
}

/// `/home`: always the product home page.
pub async fn home(req: Request<Body>) -> Response {
    match Site::get("index.html") {
        Some(f) => serve(f.data.into_owned(), "index.html", "public, max-age=300", req.headers().get(header::IF_NONE_MATCH)),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `/site/<file>`: images and other assets of the home page.
pub async fn site_file(Path(file): Path<String>, req: Request<Body>) -> Response {
    match Site::get(&file) {
        Some(f) => serve(f.data.into_owned(), &file, "public, max-age=86400", req.headers().get(header::IF_NONE_MATCH)),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
