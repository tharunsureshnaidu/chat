use axum::{extract::State, http::StatusCode, Json};

use crate::{
    errors::AppResult,
    models::user::{AuthResponse, LoginRequest, RegisterRequest},
    services::auth_service,
    AppState,
};

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> AppResult<(StatusCode, Json<AuthResponse>)> {
    let resp = auth_service::register_user(&state.pool, &state.config, req).await?;
    Ok((StatusCode::CREATED, Json(resp)))
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> AppResult<Json<AuthResponse>> {
    let resp = auth_service::login_user(&state.pool, &state.config, req).await?;
    Ok(Json(resp))
}
