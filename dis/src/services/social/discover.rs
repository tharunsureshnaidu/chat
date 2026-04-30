use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    errors::AppResult,
    models::channel::ChannelSummary,
};

/// Lightweight user result for the search endpoint.
#[derive(Debug, Clone, Serialize)]
pub struct UserSearchResult {
    pub id: Uuid,
    pub username: String,
}

pub async fn discover_channels(
    pool: &PgPool,
    user_id: Uuid,
    query: Option<&str>,
) -> AppResult<Vec<ChannelSummary>> {
    let channels = sqlx::query_as::<_, ChannelSummary>(
        r#"
        SELECT c.id, c.name, c.description, c.is_public, c.is_direct,
               c.created_by, c.created_at,
               COUNT(DISTINCT cm.user_id) AS member_count,
               MAX(CASE WHEN cm.user_id = $1 THEN cm.role END) AS my_role
        FROM   channels c
        LEFT JOIN channel_members cm ON cm.channel_id = c.id
        WHERE  c.is_direct = false
          AND  ($2::text IS NULL OR c.name ILIKE '%' || $2 || '%')
        GROUP  BY c.id
        ORDER  BY c.is_public DESC, member_count DESC, c.name ASC
        "#,
    )
    .bind(user_id)
    .bind(query)
    .fetch_all(pool)
    .await?;

    Ok(channels)
}

pub async fn search_users(
    pool: &PgPool,
    query: &str,
    caller_id: Uuid,
) -> AppResult<Vec<UserSearchResult>> {
    let users = sqlx::query_as::<_, (Uuid, String)>(
        r#"
        SELECT id, username FROM users
        WHERE  username ILIKE '%' || $1 || '%'
          AND  id != $2
        ORDER  BY username ASC
        LIMIT  20
        "#,
    )
    .bind(query)
    .bind(caller_id)
    .fetch_all(pool)
    .await?;

    Ok(users
        .into_iter()
        .map(|(id, username)| UserSearchResult { id, username })
        .collect())
}
