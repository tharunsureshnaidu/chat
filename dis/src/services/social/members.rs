use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    errors::{AppError, AppResult},
    models::social::ChannelMemberWithUser,
};

pub async fn list_members(
    pool: &PgPool,
    channel_id: Uuid,
    caller_id: Uuid,
) -> AppResult<Vec<ChannelMemberWithUser>> {
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2)",
    )
    .bind(channel_id)
    .bind(caller_id)
    .fetch_one(pool)
    .await?;

    if !is_member {
        return Err(AppError::Auth("You are not a member of this channel".into()));
    }

    let members = sqlx::query_as::<_, ChannelMemberWithUser>(
        r#"
        SELECT cm.user_id, u.username, cm.role, cm.joined_at
        FROM   channel_members cm
        JOIN   users u ON u.id = cm.user_id
        WHERE  cm.channel_id = $1
        ORDER  BY cm.role DESC, u.username ASC
        "#,
    )
    .bind(channel_id)
    .fetch_all(pool)
    .await?;

    Ok(members)
}

pub async fn remove_member(
    pool: &PgPool,
    channel_id: Uuid,
    target_id: Uuid,
    caller_id: Uuid,
) -> AppResult<()> {
    if caller_id != target_id {
        crate::services::channel_service::require_admin(pool, channel_id, caller_id).await?;
    }

    sqlx::query("DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2")
        .bind(channel_id)
        .bind(target_id)
        .execute(pool)
        .await?;

    Ok(())
}
