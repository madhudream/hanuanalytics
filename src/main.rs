//! HanuAnalytics: product analytics and session replay on one small VM, with a bucket as the durable home
//! and HanuDB as the database. One binary serves the SDK, the ingest API, the admin API and the admin app.
mod admin;
mod app;
mod assets;
mod auth;
mod buffer;
mod config;
mod events;
mod geo;
mod hanudb;
mod ids;
mod ingest;
mod jobs;
mod live;
mod meta;
mod query;
mod recordings;
mod sessions;
mod store;
mod ua;

use crate::app::{App, AppState};
use anyhow::{Context, Result};
use axum::routing::{delete, get, patch, post};
use axum::Router;
use clap::Parser;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::compression::CompressionLayer;
use tower_http::trace::TraceLayer;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,hyper=warn,h2=warn,datafusion=warn".into())).init();
    let cfg = config::Config::parse();
    let app = build(cfg).await?;
    serve(app).await
}

async fn build(cfg: config::Config) -> Result<App> {
    let node = cfg.node_name();
    tracing::info!(version = env!("CARGO_PKG_VERSION"), node, bucket = %cfg.bucket, dir = %cfg.dir, hanudb = %cfg.hanudb_url, "hanuanalytics starting");

    let store = store::Store::open(&cfg.bucket, &cfg.dir).await.context("open store")?;
    let n = store.load_catalog().await.context("list bucket")?;
    tracing::info!("catalog: {n} event files");

    let db = hanudb::HanuDb::new(&cfg.hanudb_url, &cfg.hanudb_token);
    if !db.health().await {
        tracing::warn!("HanuDB at {} is not reachable yet; retrying for 60 s", cfg.hanudb_url);
        let mut ok = false;
        for _ in 0..30 {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            if db.health().await {
                ok = true;
                break;
            }
        }
        if !ok {
            anyhow::bail!("HanuDB at {} is not reachable (HANUDB_URL / HANUDB_TOKEN)", cfg.hanudb_url);
        }
    }
    let meta = meta::Meta::new(db.clone());
    let jwt_secret = meta.secret("jwt_secret").await.context("jwt secret")?;
    let salt = if cfg.salt.is_empty() { meta.secret("visitor_salt").await? } else { cfg.salt.clone() };
    let projects = meta.refresh_projects().await?;
    tracing::info!("{projects} projects");

    // optional bootstrap admin
    if !cfg.bootstrap_admin.is_empty() && meta.user_count().await? == 0 {
        if let Some((email, pw)) = cfg.bootstrap_admin.split_once(':') {
            let u = meta.create_user(email, "Admin", &auth::hash_password(pw)?).await?;
            let o = meta.create_org("My organization", &u.id).await?;
            meta.set_setting("instance_admin", &u.id).await?;
            tracing::info!("bootstrap admin {email} created (org {})", o.id);
        }
    }

    let geo = geo::Geo::empty();
    match cfg.geo.as_str() {
        "off" => {}
        "auto" => {
            // load whatever the bucket has now; download in the background if nothing is cached
            if let Err(e) = geo::load_auto(&geo, &store).await {
                tracing::warn!("geo: {e:#} (continuing without geolocation; retried daily)");
            }
        }
        path => {
            if let Err(e) = geo::load_file(&geo, path) {
                tracing::warn!("geo: {e:#}");
            }
        }
    }
    if geo.loaded() {
        tracing::info!("geo: {}", geo.build.read());
    }

    let query = query::Query::new(store.clone(), cfg.query_mem_mb)?;
    let buffer = buffer::Buffer::new(store.clone(), node.clone(), cfg.flush_secs, cfg.flush_events);
    let index = sessions::Index::new(db.clone());
    let recordings = recordings::Recordings::new(store.clone());

    Ok(Arc::new(AppState {
        cfg,
        meta,
        store,
        geo,
        buffer,
        live: live::Live::default(),
        index,
        recordings,
        query,
        jwt_secret,
        salt,
        user_cache: auth::UserCache::new(),
        limiter: auth::LoginLimiter::new(),
        started_at: ids::now_ms(),
        node,
    }))
}

fn router(app: App) -> Router {
    let public = Router::new()
        .route("/config", get(ingest::config).options(ingest::preflight))
        .route("/e", post(ingest::events).options(ingest::preflight))
        .route("/r", post(ingest::recording).options(ingest::preflight));

    let admin = Router::new()
        .route("/setup", get(admin::setup_status).post(admin::setup))
        .route("/register", post(admin::register))
        .route("/login", post(admin::login))
        .route("/logout", post(admin::logout))
        .route("/me", get(admin::me).patch(admin::update_account))
        .route("/orgs", post(admin::create_org))
        .route("/orgs/{org}", patch(admin::update_org))
        .route("/orgs/{org}/members", get(admin::members))
        .route("/orgs/{org}/members/{user}", patch(admin::update_member).delete(admin::remove_member))
        .route("/orgs/{org}/invites", post(admin::create_invite))
        .route("/orgs/{org}/invites/{id}", delete(admin::delete_invite))
        .route("/orgs/{org}/projects", post(admin::create_project))
        .route("/invites/{token}", get(admin::invite_info))
        .route("/invites/{token}/accept", post(admin::accept_invite))
        .route("/projects/{id}", get(admin::get_project).patch(admin::patch_project).delete(admin::delete_project))
        .route("/projects/{id}/rotate-key", post(admin::rotate_key))
        .route("/projects/{id}/stats/overview", get(admin::overview))
        .route("/projects/{id}/stats/breakdown", get(admin::breakdown))
        .route("/projects/{id}/stats/events", get(admin::events_list))
        .route("/projects/{id}/stats/events/{event}/keys", get(admin::event_keys))
        .route("/projects/{id}/stats/events/{event}/props", get(admin::event_props))
        .route("/projects/{id}/stats/funnel", get(admin::funnel))
        .route("/projects/{id}/stats/retention", get(admin::retention))
        .route("/projects/{id}/stats/errors", get(admin::errors))
        .route("/projects/{id}/stats/vitals", get(admin::vitals))
        .route("/projects/{id}/live", get(admin::live))
        .route("/projects/{id}/sessions", get(admin::sessions))
        .route("/projects/{id}/sessions/{sid}", get(admin::session))
        .route("/projects/{id}/sessions/{sid}/recording", get(admin::session_recording))
        .route("/projects/{id}/persons", get(admin::persons))
        .route("/projects/{id}/persons/{did}", get(admin::person))
        .route("/projects/{id}/sql", post(admin::sql))
        .route("/system", get(admin::system).patch(admin::patch_system))
        .route("/system/compact", post(admin::compact));

    Router::new()
        .route("/health", get(|| async { "ok" }))
        .nest("/api/v1", public)
        .nest("/api/admin", admin)
        .route("/{file}", get(sdk_or_admin))
        .fallback(assets::admin)
        .layer(CompressionLayer::new().gzip(true).br(true))
        .layer(TraceLayer::new_for_http())
        .layer(axum::extract::DefaultBodyLimit::max(8 * 1024 * 1024))
        .with_state(app)
}

/// `/hanu*.js` comes from the SDK bundle; any other top-level path is the admin app.
async fn sdk_or_admin(path: axum::extract::Path<String>, uri: axum::http::Uri, req: axum::http::Request<axum::body::Body>) -> axum::response::Response {
    if path.0.starts_with("hanu") && path.0.ends_with(".js") {
        assets::sdk(path, req).await
    } else {
        assets::admin(uri, req).await
    }
}

async fn serve(app: App) -> Result<()> {
    jobs::spawn_all(app.clone());
    let addr: SocketAddr = app.cfg.listen.parse().with_context(|| format!("bad --listen {}", app.cfg.listen))?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("listening on http://{addr}");
    let app2 = app.clone();
    axum::serve(listener, router(app).into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(async move {
            let ctrl_c = tokio::signal::ctrl_c();
            #[cfg(unix)]
            {
                let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("sigterm");
                tokio::select! { _ = ctrl_c => {}, _ = term.recv() => {} }
            }
            #[cfg(not(unix))]
            {
                let _ = ctrl_c.await;
            }
            jobs::shutdown(&app2).await;
        })
        .await?;
    Ok(())
}
