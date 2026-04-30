use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    errors::{AppError, AppResult},
    models::social::JoinRequestWithUser,
    ws::manager::WsManager,
};

pub async fn request_join(pool: &PgPool, channel_id: Uuid, user_id: Uuid) -> AppResult<()> {
    let channel: Option<(bool, bool)> = sqlx::query_as(
        "SELECT is_public, is_direct FROM channels WHERE id = $1",
    )
    .bind(channel_id)
    .fetch_optional(pool)
    .await?;

    let (is_public, is_direct) = channel
        .ok_or_else(|| AppError::NotFound(format!("Channel {channel_id} not found")))?;

    if is_direct {
        return Err(AppError::Validation("Cannot join a DM channel".into()));
    }

    let already_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2)",
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    if already_member {
        return Err(AppError::Conflict("You are already a member".into()));
    }

    if is_public {
        sqlx::query(
            "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'member')
             ON CONFLICT DO NOTHING",
        )
        .bind(channel_id)
        .bind(user_id)
        .execute(pool)
        .await?;
    } else {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM join_requests WHERE channel_id = $1 AND user_id = $2 AND status = 'pending')",
        )
        .bind(channel_id)
        .bind(user_id)
        .fetch_one(pool)
        .await?;

        if exists {
            return Err(AppError::Conflict("Join request already pending".into()));
        }

        sqlx::query(
            "INSERT INTO join_requests (channel_id, user_id) VALUES ($1, $2)
             ON CONFLICT (channel_id, user_id) DO UPDATE SET status = 'pending'",
        )
        .bind(channel_id)
        .bind(user_id)
        .execute(pool)
        .await?;
    }

    Ok(())
}

pub async fn list_join_requests(
    pool: &PgPool,
    channel_id: Uuid,
    caller_id: Uuid,
) -> AppResult<Vec<JoinRequestWithUser>> {
    crate::services::channel_service::require_admin(pool, channel_id, caller_id).await?;

    let requests = sqlx::query_as::<_, JoinRequestWithUser>(
        r#"
        SELECT jr.id, jr.channel_id, c.name AS channel_name,
               jr.user_id, u.username, jr.status, jr.created_at
        FROM   join_requests jr
        JOIN   users u   ON u.id = jr.user_id
        JOIN   channels c ON c.id = jr.channel_id
        WHERE  jr.channel_id = $1 AND jr.status = 'pending'
        ORDER  BY jr.created_at ASC
        "#,
    )
    .bind(channel_id)
    .fetch_all(pool)
    .await?;

    Ok(requests)
}

/// Returns all pending join requests for every channel the caller admins.
pub async fn list_admin_join_requests(
    pool: &PgPool,
    admin_id: Uuid,
) -> AppResult<Vec<JoinRequestWithUser>> {
    let requests = sqlx::query_as::<_, JoinRequestWithUser>(
        r#"
        SELECT jr.id, jr.channel_id, c.name AS channel_name,
               jr.user_id, u.username, jr.status, jr.created_at
        FROM   join_requests jr
        JOIN   users u   ON u.id = jr.user_id
        JOIN   channels c ON c.id = jr.channel_id
        JOIN   channel_members cm ON cm.channel_id = jr.channel_id AND cm.user_id = $1
        WHERE  jr.status = 'pending'
          AND  cm.role = 'admin'
        ORDER  BY jr.created_at ASC
        "#,
    )
    .bind(admin_id)
    .fetch_all(pool)
    .await?;

    Ok(requests)
}

pub async fn respond_to_join_request(
    pool: &PgPool,
    ws: &WsManager,
    request_id: Uuid,
    admin_id: Uuid,
    approve: bool,
) -> AppResult<()> {
    let row: Option<(Uuid, Uuid, String)> = sqlx::query_as(
        "SELECT channel_id, user_id, status FROM join_requests WHERE id = $1",
    )
    .bind(request_id)
    .fetch_optional(pool)
    .await?;

    let (channel_id, requester_id, status) =
        row.ok_or_else(|| AppError::NotFound("Join request not found".into()))?;

    if status != "pending" {
        return Err(AppError::Conflict("Join request already resolved".into()));
    }

    crate::services::channel_service::require_admin(pool, channel_id, admin_id).await?;

    let new_status = if approve { "approved" } else { "rejected" };

    let mut tx = pool.begin().await?;

    sqlx::query("UPDATE join_requests SET status = $1 WHERE id = $2")
        .bind(new_status)
        .bind(request_id)
        .execute(&mut *tx)
        .await?;

    if approve {
        sqlx::query(
            "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'member')
             ON CONFLICT DO NOTHING",
        )
        .bind(channel_id)
        .bind(requester_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    let event = if approve {
        json!({ "type": "join_request_approved", "channel_id": channel_id })
    } else {
        json!({ "type": "join_request_rejected", "channel_id": channel_id })
    };
    ws.send_to(requester_id, event.to_string());

    Ok(())
}
