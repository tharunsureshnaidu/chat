use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Raw message row from the `messages` table.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Message {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

/// Message joined with the author's username — used in list responses.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MessageWithAuthor {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub username: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
}

/// Cursor-based pagination query parameters.
///
/// - `before_id`: fetch messages created *before* the given message (infinite scroll up)
/// - `after_id`:  fetch messages created *after* the given message (offline sync catch-up)
/// - `limit`: max results (1–100, default 50)
#[derive(Debug, Deserialize)]
pub struct MessageQuery {
    pub limit: Option<i64>,
    pub before_id: Option<Uuid>,
    pub after_id: Option<Uuid>,
}
