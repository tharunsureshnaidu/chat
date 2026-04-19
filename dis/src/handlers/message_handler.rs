use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use uuid::Uuid;

use crate::{
    errors::{AppError, AppResult},
    kafka::producer::KafkaEnvelope,
    middleware::auth::AuthUser,
    models::message::{MessageQuery, MessageWithAuthor, SendMessageRequest},
    services::message_service,
    AppState,
};

pub async fn send_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<SendMessageRequest>,
) -> AppResult<StatusCode> {
    let content = req.content.trim().to_string();

    if content.is_empty() {
        return Err(AppError::Validation("Message content cannot be empty".into()));
    }
    if content.len() > 4000 {
        return Err(AppError::Validation("Message content exceeds 4 000-character limit".into()));
    }

    // username is embedded in the JWT — no DB round-trip needed.
    let envelope = KafkaEnvelope {
        id: Uuid::new_v4(),
        channel_id,
        user_id: auth.user_id,
        username: auth.username,
        content,
        timestamp: Utc::now().to_rfc3339(),
    };

    state
        .kafka
        .publish(&envelope)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(StatusCode::ACCEPTED)
}

pub async fn get_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<MessageQuery>,
) -> AppResult<Json<Vec<MessageWithAuthor>>> {
    // Single round-trip: fetch visibility + caller's membership together.
    // If the channel doesn't exist the row is None and we fall through to
    // get_messages which returns an empty list (existing behaviour preserved).
    let row: Option<(bool, bool)> = sqlx::query_as(
        r#"SELECT c.is_public,
                  EXISTS(
                      SELECT 1 FROM channel_members
                      WHERE channel_id = c.id AND user_id = $2
                  ) AS is_member
           FROM channels c
           WHERE c.id = $1"#,
    )
    .bind(channel_id)
    .bind(auth.user_id)
    .fetch_optional(&state.pool)
    .await?;

    if let Some((false, false)) = row {
        return Err(AppError::Auth(
            "You must be a member to read messages in this private channel".into(),
        ));
    }

    let msgs = message_service::get_messages(&state.pool, channel_id, query).await?;
    Ok(Json(msgs))
}
