use axum::{
    extract::FromRequestParts,
    http::{header, request::Parts},
};
use uuid::Uuid;

use crate::{errors::AppError, services::auth_service::validate_token, AppState};

/// Extractor that validates a Bearer JWT and injects the caller's identity.
///
/// Any handler that declares `auth: AuthUser` (or `_auth: AuthUser`) as a
/// parameter is automatically protected — unauthenticated requests receive
/// `401 Unauthorized` before the handler body runs.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub username: String,
}

#[async_trait::async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        // Extract the raw header value
        let auth_header = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| AppError::Auth("Missing Authorization header".into()))?;

        // Expect the standard "Bearer <token>" scheme
        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or_else(|| {
                AppError::Auth(
                    "Authorization header must use the Bearer scheme".into(),
                )
            })?;

        let claims = validate_token(token, &state.config)?;

        let user_id = Uuid::parse_str(&claims.sub)
            .map_err(|_| AppError::Auth("Malformed user ID in token".into()))?;

        Ok(AuthUser {
            user_id,
            username: claims.username,
        })
    }
}
