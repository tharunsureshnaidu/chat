use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    errors::{AppError, AppResult},
    models::channel::{Channel, ChannelSummary, CreateChannelRequest, UpdateChannelRequest},
};

pub async fn create_channel(
    pool: &PgPool,
    creator_id: Uuid,
    req: CreateChannelRequest,
) -> AppResult<Channel> {
    let name = req.name.trim().to_lowercase();

    if name.len() < 2 || name.len() > 100 {
        return Err(AppError::Validation(
            "Channel name must be 2–100 characters".into(),
        ));
    }
    if name.chars().any(|c| !c.is_alphanumeric() && c != '-' && c != '_') {
        return Err(AppError::Validation(
            "Channel name may only contain letters, numbers, hyphens, and underscores".into(),
        ));
    }

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM channels WHERE name = $1)")
        .bind(&name)
        .fetch_one(pool)
        .await?;

    if exists {
        return Err(AppError::Conflict("Channel name already taken".into()));
    }

    let mut tx = pool.begin().await?;

    let channel = sqlx::query_as::<_, Channel>(
        "INSERT INTO channels (id, name, description, is_public, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(&name)
    .bind(req.description.as_deref())
    .bind(req.is_public)
    .bind(creator_id)
    .fetch_one(&mut *tx)
    .await?;

    // Creator is automatically an admin member.
    sqlx::query(
        "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'admin')",
    )
    .bind(channel.id)
    .bind(creator_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(channel)
}

pub async fn list_my_channels(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<ChannelSummary>> {
    let channels = sqlx::query_as::<_, ChannelSummary>(
        r#"
        SELECT c.id, c.name, c.description, c.is_public, c.is_direct,
               c.created_by, c.created_at,
               COUNT(DISTINCT cm2.user_id) AS member_count,
               cm.role AS my_role
        FROM   channels c
        JOIN   channel_members cm  ON cm.channel_id = c.id AND cm.user_id = $1
        LEFT JOIN channel_members cm2 ON cm2.channel_id = c.id
        WHERE  c.is_direct = false
        GROUP  BY c.id, cm.role
        ORDER  BY c.name ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(channels)
}

pub async fn list_my_dms(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<ChannelSummary>> {
    let channels = sqlx::query_as::<_, ChannelSummary>(
        r#"
        SELECT c.id, c.name, c.description, c.is_public, c.is_direct,
               c.created_by, c.created_at,
               COUNT(DISTINCT cm2.user_id) AS member_count,
               cm.role AS my_role
        FROM   channels c
        JOIN   channel_members cm  ON cm.channel_id = c.id AND cm.user_id = $1
        LEFT JOIN channel_members cm2 ON cm2.channel_id = c.id
        WHERE  c.is_direct = true
        GROUP  BY c.id, cm.role
        ORDER  BY c.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(channels)
}

pub async fn get_channel(pool: &PgPool, channel_id: Uuid) -> AppResult<Channel> {
    sqlx::query_as::<_, Channel>("SELECT * FROM channels WHERE id = $1")
        .bind(channel_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Channel {channel_id} not found")))
}

pub async fn update_channel(
    pool: &PgPool,
    channel_id: Uuid,
    caller_id: Uuid,
    req: UpdateChannelRequest,
) -> AppResult<Channel> {
    require_admin(pool, channel_id, caller_id).await?;

    let channel = sqlx::query_as::<_, Channel>(
        r#"
        UPDATE channels SET
            name        = COALESCE($1, name),
            description = COALESCE($2, description),
            is_public   = COALESCE($3, is_public)
        WHERE id = $4
        RETURNING *
        "#,
    )
    .bind(req.name.as_deref())
    .bind(req.description.as_deref())
    .bind(req.is_public)
    .bind(channel_id)
    .fetch_one(pool)
    .await?;

    Ok(channel)
}

pub async fn delete_channel(
    pool: &PgPool,
    channel_id: Uuid,
    caller_id: Uuid,
) -> AppResult<()> {
    require_admin(pool, channel_id, caller_id).await?;
    sqlx::query("DELETE FROM channels WHERE id = $1")
        .bind(channel_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Require that `caller_id` is an admin of `channel_id`.
pub async fn require_admin(
    pool: &PgPool,
    channel_id: Uuid,
    caller_id: Uuid,
) -> AppResult<()> {
    let role: Option<String> =
        sqlx::query_scalar(
            "SELECT role FROM channel_members WHERE channel_id = $1 AND user_id = $2",
        )
        .bind(channel_id)
        .bind(caller_id)
        .fetch_optional(pool)
        .await?;

    match role.as_deref() {
        Some("admin") => Ok(()),
        Some(_) => Err(AppError::Auth("Admin permission required".into())),
        None => Err(AppError::Auth("You are not a member of this channel".into())),
    }
}

/// Returns true if the user is a member (any role) of the channel.
pub async fn is_member(pool: &PgPool, channel_id: Uuid, user_id: Uuid) -> bool {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2)",
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false)
}
