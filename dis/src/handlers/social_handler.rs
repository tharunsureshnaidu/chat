use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{
    errors::AppResult,
    middleware::auth::AuthUser,
    models::{
        channel::ChannelSummary,
        social::{
            ChannelInviteDetails, FriendRequestWithUser, FriendWithUser, InviteUserRequest,
            JoinRequestWithUser, SendFriendRequestBody,
        },
    },
    services::social_service,
    AppState,
};

// ── Discover ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
}

pub async fn discover_channels(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(params): Query<SearchQuery>,
) -> AppResult<Json<Vec<ChannelSummary>>> {
    let channels = social_service::discover_channels(
        &state.pool,
        auth.user_id,
        params.q.as_deref(),
    )
    .await?;
    Ok(Json(channels))
}

pub async fn search_users(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(params): Query<SearchQuery>,
) -> AppResult<Json<Vec<serde_json::Value>>> {
    let q = params.q.unwrap_or_default();
    if q.trim().is_empty() {
        return Ok(Json(vec![]));
    }
    let users = social_service::search_users(&state.pool, &q, auth.user_id).await?;
    Ok(Json(users))
}

// ── Join requests ─────────────────────────────────────────────────────────────

pub async fn join_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    social_service::request_join(&state.pool, channel_id, auth.user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_admin_join_requests(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<JoinRequestWithUser>>> {
    let requests =
        social_service::list_admin_join_requests(&state.pool, auth.user_id).await?;
    Ok(Json(requests))
}

pub async fn list_join_requests(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<Json<Vec<JoinRequestWithUser>>> {
    let requests =
        social_service::list_join_requests(&state.pool, channel_id, auth.user_id).await?;
    Ok(Json(requests))
}

#[derive(Deserialize)]
pub struct ApproveBody {
    pub approve: bool,
}

pub async fn respond_to_join_request(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(request_id): Path<Uuid>,
    Json(body): Json<ApproveBody>,
) -> AppResult<StatusCode> {
    social_service::respond_to_join_request(
        &state.pool,
        &state.ws_manager,
        request_id,
        auth.user_id,
        body.approve,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Channel invites ───────────────────────────────────────────────────────────

pub async fn invite_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<InviteUserRequest>,
) -> AppResult<StatusCode> {
    social_service::invite_user(
        &state.pool,
        &state.ws_manager,
        channel_id,
        auth.user_id,
        &body.username,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_my_invites(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<ChannelInviteDetails>>> {
    let invites = social_service::list_my_invites(&state.pool, auth.user_id).await?;
    Ok(Json(invites))
}

#[derive(Deserialize)]
pub struct AcceptBody {
    pub accept: bool,
}

pub async fn respond_to_invite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(invite_id): Path<Uuid>,
    Json(body): Json<AcceptBody>,
) -> AppResult<StatusCode> {
    social_service::respond_to_invite(&state.pool, invite_id, auth.user_id, body.accept).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Friends ───────────────────────────────────────────────────────────────────

pub async fn send_friend_request(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<SendFriendRequestBody>,
) -> AppResult<StatusCode> {
    social_service::send_friend_request(
        &state.pool,
        &state.ws_manager,
        auth.user_id,
        &auth.username,
        &body.username,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_friend_requests(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<FriendRequestWithUser>>> {
    let requests = social_service::list_friend_requests(&state.pool, auth.user_id).await?;
    Ok(Json(requests))
}

pub async fn respond_to_friend_request(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(request_id): Path<Uuid>,
    Json(body): Json<AcceptBody>,
) -> AppResult<StatusCode> {
    social_service::respond_to_friend_request(
        &state.pool,
        &state.ws_manager,
        request_id,
        auth.user_id,
        body.accept,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_friends(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<FriendWithUser>>> {
    let friends = social_service::list_friends(&state.pool, auth.user_id).await?;
    Ok(Json(friends))
}
