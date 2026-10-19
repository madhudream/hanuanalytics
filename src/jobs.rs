//! Background work: periodic flushes, index writes, compaction, retention, geo refresh, reconcile, and the
//! graceful shutdown that flushes everything before the process exits.
use crate::app::App;
use crate::meta::SESSIONS;
use crate::sessions::SessionDoc;
use std::time::Duration;

pub fn spawn_all(app: App) {
    // event buffer: every 5 s check what is due
    {
        let app = app.clone();
        tokio::spawn(async move {
            let mut t = tokio::time::interval(Duration::from_secs(5));
            loop {
                t.tick().await;
                if let Err(e) = app.buffer.flush(false).await {
                    tracing::error!("flush: {e:#}");
                }
            }
        });
    }
    // session / person index -> HanuDB every 5 s
    {
        let app = app.clone();
        tokio::spawn(async move {
            let mut t = tokio::time::interval(Duration::from_secs(5));
            loop {
                t.tick().await;
                if let Err(e) = app.index.flush().await {
                    tracing::warn!("index flush: {e:#}");
                }
            }
        });
    }
    // recordings idle flush every 10 s
    {
        let app = app.clone();
        tokio::spawn(async move {
            let mut t = tokio::time::interval(Duration::from_secs(10));
            loop {
                t.tick().await;
                if let Err(e) = app.recordings.flush_idle(&app.index, false).await {
                    tracing::warn!("recording flush: {e:#}");
                }
            }
        });
    }
    // project cache refresh every 30 s
    {
        let app = app.clone();
        tokio::spawn(async move {
            let mut t = tokio::time::interval(Duration::from_secs(30));
            loop {
                t.tick().await;
                if let Err(e) = app.meta.refresh_projects().await {
                    tracing::warn!("project cache refresh: {e:#}");
                }
            }
        });
    }
    // hourly: merge last hour's files; reconcile uploads
    {
        let app = app.clone();
        tokio::spawn(async move {
            let mut t = tokio::time::interval(Duration::from_secs(3600));
            t.tick().await; // skip the immediate first tick
            loop {
                t.tick().await;
                match app.buffer.compact_recent().await {
                    Ok(n) if n > 0 => tracing::info!("hourly compaction merged {n} files"),
                    Err(e) => tracing::warn!("hourly compaction: {e:#}"),
                    _ => {}
                }
                match app.store.reconcile().await {
                    Ok(n) if n > 0 => tracing::info!("reconcile uploaded {n} files"),
                    Err(e) => tracing::warn!("reconcile: {e:#}"),
                    _ => {}
                }
            }
        });
    }
    // daily at ~00:20 UTC: merge yesterday, apply retention, refresh geo monthly
    {
        let app = app.clone();
        tokio::spawn(async move {
            loop {
                let now = chrono::Utc::now();
                let next = (now + chrono::Duration::days(1)).date_naive().and_hms_opt(0, 20, 0).unwrap().and_utc();
                let wait = (next - now).to_std().unwrap_or(Duration::from_secs(3600));
                tokio::time::sleep(wait).await;
                daily(&app).await;
            }
        });
    }
}

pub async fn daily(app: &App) {
    match app.buffer.compact_days().await {
        Ok(n) => tracing::info!("daily compaction merged {n} files"),
        Err(e) => tracing::warn!("daily compaction: {e:#}"),
    }
    for p in app.meta.cached_projects() {
        match app.buffer.apply_retention(&p.id, p.retention_days).await {
            Ok(n) if n > 0 => tracing::info!("retention {}: deleted {n} event files", p.name),
            Err(e) => tracing::warn!("retention {}: {e:#}", p.name),
            _ => {}
        }
        // recordings older than recording_retention_days
        let cutoff = crate::ids::now_ms() - (p.recording_retention_days as i64) * 86_400_000;
        let filter = serde_json::json!({"project_id": p.id, "has_recording": true, "start": {"$lt": cutoff}});
        if let Ok(r) = app.meta.db.find::<SessionDoc>(SESSIONS, crate::hanudb::Find::filter(filter).limit(500)).await {
            for mut s in r.hits {
                if app.recordings.delete_session(&p.id, &s.session_id).await.is_ok() {
                    s.has_recording = false;
                    s.rec_chunks = 0;
                    s.rec_bytes = 0;
                    let _ = app.meta.db.put_t(SESSIONS, &s.id, &s).await;
                }
            }
        }
    }
    if app.cfg.geo == "auto" {
        if let Err(e) = crate::geo::load_auto(&app.geo, &app.store).await {
            tracing::warn!("geo refresh: {e:#}");
        }
    }
}

/// Flush everything we hold in memory. Called on SIGTERM / Ctrl-C.
pub async fn shutdown(app: &App) {
    tracing::info!("shutting down: flushing buffers");
    if let Err(e) = app.buffer.flush(true).await {
        tracing::error!("flush: {e:#}");
    }
    if let Err(e) = app.recordings.flush_idle(&app.index, true).await {
        tracing::error!("recordings: {e:#}");
    }
    if let Err(e) = app.index.flush().await {
        tracing::error!("index: {e:#}");
    }
    // give in-flight uploads a moment
    tokio::time::sleep(Duration::from_millis(1500)).await;
    tracing::info!("bye");
}
