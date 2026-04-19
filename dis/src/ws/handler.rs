use axum::{
    extract::{ws::WebSocketUpgrade, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{
    services::auth_service::validate_token,
    ws::connection::handle_connection,
    AppState,
};

/// Query parameters expected on the `/ws` endpoint.
///
/// The JWT is passed as a query parameter because the browser's native
/// `WebSocket` API does not support setting custom request headers.
#[derive(Debug, Deserialize)]
pub struct WsQueryParams {
    token: String,
}

/// HTTP handler that upgrades a GET request to a WebSocket connection.
///
/// Authentication is performed **before** the upgrade completes so that
/// invalid tokens receive a plain `401` HTTP response rather than an
/// immediately-closed socket.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<WsQueryParams>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    // Validate the JWT before accepting the upgrade.
    let claims = match validate_token(&params.token, &state.config) {
        Ok(c) => c,
        Err(_) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Invalid or expired token" })),
            )
                .into_response();
        }
    };

    let user_id = match Uuid::parse_str(&claims.sub) {
        Ok(id) => id,
        Err(_) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Malformed token subject" })),
            )
                .into_response();
        }
    };

    let username = claims.username;
    let manager = state.ws_manager.clone();
    let kafka = state.kafka.clone();
    let redis_pool = state.redis_pool.clone();
    let config = state.config.clone();
    let pool = state.pool.clone();

    // Complete the HTTP → WebSocket upgrade and hand off to the connection driver.
    ws.on_upgrade(move |socket| {
        handle_connection(socket, user_id, username, manager, kafka, redis_pool, config, pool)
    })
}
