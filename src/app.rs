//! Shared state for every handler.
use crate::auth::{LoginLimiter, UserCache};
use crate::buffer::Buffer;
use crate::config::Config;
use crate::geo::Geo;
use crate::live::Live;
use crate::meta::Meta;
use crate::query::Query;
use crate::recordings::Recordings;
use crate::sessions::Index;
use crate::store::Store;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use std::sync::Arc;

pub struct AppState {
    pub cfg: Config,
    pub meta: Meta,
    pub store: Store,
    pub geo: Geo,
    pub buffer: Buffer,
    pub live: Live,
    pub index: Index,
    pub recordings: Recordings,
    pub query: Query,
    pub jwt_secret: String,
    pub salt: String,
    pub user_cache: UserCache,
    pub limiter: LoginLimiter,
    pub started_at: i64,
    pub node: String,
}

pub type App = Arc<AppState>;

/// `{"error": "..."}` with a status.
#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub String);

impl ApiError {
    pub fn bad(msg: impl Into<String>) -> Self {
        ApiError(StatusCode::BAD_REQUEST, msg.into())
    }
    pub fn unauthorized(msg: impl Into<String>) -> Self {
        ApiError(StatusCode::UNAUTHORIZED, msg.into())
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        ApiError(StatusCode::FORBIDDEN, msg.into())
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        ApiError(StatusCode::NOT_FOUND, msg.into())
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        ApiError(StatusCode::CONFLICT, msg.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        tracing::error!("{e:#}");
        ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    }
}

pub type ApiResult<T = Json<serde_json::Value>> = Result<T, ApiError>;
