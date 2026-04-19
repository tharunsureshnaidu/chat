use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::json;
use uuid::Uuid;

use crate::{
    errors::AppResult,
    middleware::auth::AuthUser,
    presence::service as presence,
    AppState,
};

pub async fn get_presence(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(user_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let online = presence::is_online(&state.redis_pool, user_id).await;
    Ok(Json(json!({ "user_id": user_id, "online": online })))
}
