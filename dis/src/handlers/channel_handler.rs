use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

use crate::{
    errors::AppResult,
    middleware::auth::AuthUser,
    models::channel::{Channel, ChannelSummary, CreateChannelRequest, UpdateChannelRequest},
    models::social::ChannelMemberWithUser,
    services::{channel_service, social_service},
    AppState,
};

pub async fn create_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateChannelRequest>,
) -> AppResult<(StatusCode, Json<Channel>)> {
    let channel = channel_service::create_channel(&state.pool, auth.user_id, req).await?;
    Ok((StatusCode::CREATED, Json(channel)))
}

pub async fn list_my_channels(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<ChannelSummary>>> {
    let channels = channel_service::list_my_channels(&state.pool, auth.user_id).await?;
    Ok(Json(channels))
}

pub async fn list_my_dms(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<ChannelSummary>>> {
    let channels = channel_service::list_my_dms(&state.pool, auth.user_id).await?;
    Ok(Json(channels))
}

pub async fn get_channel(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<Json<Channel>> {
    let channel = channel_service::get_channel(&state.pool, channel_id).await?;
    Ok(Json(channel))
}

pub async fn update_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<UpdateChannelRequest>,
) -> AppResult<Json<Channel>> {
    let channel =
        channel_service::update_channel(&state.pool, channel_id, auth.user_id, req).await?;
    Ok(Json(channel))
}

pub async fn delete_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    channel_service::delete_channel(&state.pool, channel_id, auth.user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_members(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<Json<Vec<ChannelMemberWithUser>>> {
    let members =
        social_service::list_members(&state.pool, channel_id, auth.user_id).await?;
    Ok(Json(members))
}

pub async fn remove_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((channel_id, target_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    social_service::remove_member(&state.pool, channel_id, target_id, auth.user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
