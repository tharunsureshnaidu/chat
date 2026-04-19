use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use serde_json::json;

use crate::{
    handlers::{auth_handler, channel_handler, message_handler, presence_handler, social_handler},
    ws::handler::ws_handler,
    AppState,
};

pub fn create_router(state: AppState) -> Router {
    Router::new()
        // ── Health ────────────────────────────────────────────────────────────
        .route("/health", get(health))
        // ── Auth ──────────────────────────────────────────────────────────────
        .route("/api/auth/register", post(auth_handler::register))
        .route("/api/auth/login", post(auth_handler::login))
        // ── Channels (CRUD + membership) ──────────────────────────────────────
        .route(
            "/api/channels",
            post(channel_handler::create_channel).get(channel_handler::list_my_channels),
        )
        .route("/api/channels/dms", get(channel_handler::list_my_dms))
        .route(
            "/api/channels/:channel_id",
            get(channel_handler::get_channel)
                .put(channel_handler::update_channel)
                .delete(channel_handler::delete_channel),
        )
        .route(
            "/api/channels/:channel_id/members",
            get(channel_handler::list_members),
        )
        .route(
            "/api/channels/:channel_id/members/:user_id",
            delete(channel_handler::remove_member),
        )
        // ── Join (public = direct, private = request) ─────────────────────────
        .route(
            "/api/channels/:channel_id/join",
            post(social_handler::join_channel),
        )
        .route(
            "/api/channels/:channel_id/join-requests",
            get(social_handler::list_join_requests),
        )
        .route("/api/join-requests", get(social_handler::list_admin_join_requests))
        .route(
            "/api/join-requests/:request_id",
            post(social_handler::respond_to_join_request),
        )
        // ── Channel invites ───────────────────────────────────────────────────
        .route(
            "/api/channels/:channel_id/invite",
            post(social_handler::invite_user),
        )
        .route("/api/invites", get(social_handler::list_my_invites))
        .route(
            "/api/invites/:invite_id",
            post(social_handler::respond_to_invite),
        )
        // ── Friends ───────────────────────────────────────────────────────────
        .route(
            "/api/friends",
            get(social_handler::list_friends).post(social_handler::send_friend_request),
        )
        .route(
            "/api/friend-requests",
            get(social_handler::list_friend_requests),
        )
        .route(
            "/api/friend-requests/:request_id",
            post(social_handler::respond_to_friend_request),
        )
        // ── Discover + user search ────────────────────────────────────────────
        .route("/api/discover/channels", get(social_handler::discover_channels))
        .route("/api/discover/users", get(social_handler::search_users))
        // ── Messages ──────────────────────────────────────────────────────────
        .route(
            "/api/channels/:channel_id/messages",
            post(message_handler::send_message).get(message_handler::get_messages),
        )
        // ── WebSocket ─────────────────────────────────────────────────────────
        .route("/ws", get(ws_handler))
        // ── Presence ──────────────────────────────────────────────────────────
        .route("/api/presence/:user_id", get(presence_handler::get_presence))
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    let db_ok = sqlx::query("SELECT 1").execute(&state.pool).await.is_ok();
    let redis_ok = crate::ws::redis_pubsub::ping(&state.redis_pool).await;

    let status = if db_ok && redis_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        status,
        Json(json!({
            "status":  if db_ok && redis_ok { "ok" } else { "degraded" },
            "db":      if db_ok    { "ok" } else { "error" },
            "redis":   if redis_ok { "ok" } else { "error" },
        })),
    )
}
