use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    errors::{AppError, AppResult},
    models::message::{Message, MessageQuery, MessageWithAuthor, SendMessageRequest},
};

pub async fn send_message(
    pool: &PgPool,
    channel_id: Uuid,
    user_id: Uuid,
    req: SendMessageRequest,
) -> AppResult<Message> {
    let content = req.content.trim().to_string();

    if content.is_empty() {
        return Err(AppError::Validation("Message content cannot be empty".into()));
    }
    if content.len() > 4000 {
        return Err(AppError::Validation(
            "Message content exceeds the 4 000-character limit".into(),
        ));
    }

    // Verify channel exists (gives a clean 404 instead of a FK violation)
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM channels WHERE id = $1)")
        .bind(channel_id)
        .fetch_one(pool)
        .await?;

    if !exists {
        return Err(AppError::NotFound(format!(
            "Channel {channel_id} not found"
        )));
    }

    let message = sqlx::query_as::<_, Message>(
        "INSERT INTO messages (id, channel_id, user_id, content)
         VALUES ($1, $2, $3, $4)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(channel_id)
    .bind(user_id)
    .bind(&content)
    .fetch_one(pool)
    .await?;

    Ok(message)
}

pub async fn get_messages(
    pool: &PgPool,
    channel_id: Uuid,
    query: MessageQuery,
) -> AppResult<Vec<MessageWithAuthor>> {
    // Clamp limit between 1 and 100, default 50
    let limit = query.limit.unwrap_or(50).clamp(1, 100);

    let (cursor_clause, order, cursor_id) = match (&query.after_id, &query.before_id) {
        (Some(id), _) => (
            "AND m.created_at > (SELECT created_at FROM messages WHERE id = $2)",
            "ASC",
            Some(*id),
        ),
        (_, Some(id)) => (
            "AND m.created_at < (SELECT created_at FROM messages WHERE id = $2)",
            "DESC",
            Some(*id),
        ),
        _ => ("", "DESC", None),
    };

    // When there is no cursor we shift the limit bind from $3 → $2.
    let sql = if cursor_id.is_some() {
        format!(
            r#"
            SELECT m.id, m.channel_id, m.user_id, u.username, m.content, m.created_at
            FROM   messages m
            JOIN   users    u ON u.id = m.user_id
            WHERE  m.channel_id = $1 {cursor_clause}
            ORDER  BY m.created_at {order}
            LIMIT  $3
            "#
        )
    } else {
        format!(
            r#"
            SELECT m.id, m.channel_id, m.user_id, u.username, m.content, m.created_at
            FROM   messages m
            JOIN   users    u ON u.id = m.user_id
            WHERE  m.channel_id = $1
            ORDER  BY m.created_at {order}
            LIMIT  $2
            "#
        )
    };

    let messages = if let Some(cid) = cursor_id {
        sqlx::query_as::<_, MessageWithAuthor>(&sql)
            .bind(channel_id)
            .bind(cid)
            .bind(limit)
            .fetch_all(pool)
            .await?
    } else {
        sqlx::query_as::<_, MessageWithAuthor>(&sql)
            .bind(channel_id)
            .bind(limit)
            .fetch_all(pool)
            .await?
    };

    Ok(messages)
}
