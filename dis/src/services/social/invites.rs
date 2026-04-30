use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    errors::{AppError, AppResult},
    models::social::ChannelInviteDetails,
    ws::manager::WsManager,
};

pub async fn invite_user(
    pool: &PgPool,
    ws: &WsManager,
    channel_id: Uuid,
    inviter_id: Uuid,
    username: &str,
) -> AppResult<()> {
    crate::services::channel_service::require_admin(pool, channel_id, inviter_id).await?;

    let invitee: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM users WHERE username = $1")
            .bind(username)
            .fetch_optional(pool)
            .await?;

    let (invitee_id,) =
        invitee.ok_or_else(|| AppError::NotFound(format!("User '{username}' not found")))?;

    let already_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2)",
    )
    .bind(channel_id)
    .bind(invitee_id)
    .fetch_one(pool)
    .await?;

    if already_member {
        return Err(AppError::Conflict("User is already a member".into()));
    }

    sqlx::query(
        "INSERT INTO channel_invites (channel_id, inviter_id, invitee_id) VALUES ($1, $2, $3)
         ON CONFLICT (channel_id, invitee_id) DO UPDATE SET status = 'pending', inviter_id = $2",
    )
    .bind(channel_id)
    .bind(inviter_id)
    .bind(invitee_id)
    .execute(pool)
    .await?;

    let notify: Option<(String, String)> = sqlx::query_as(
        "SELECT c.name, u.username FROM channels c, users u WHERE c.id = $1 AND u.id = $2",
    )
    .bind(channel_id)
    .bind(inviter_id)
    .fetch_optional(pool)
    .await?;

    let (channel_name, inviter_username) = notify
        .map(|(cn, iu)| (Some(cn), Some(iu)))
        .unwrap_or((None, None));

    ws.send_to(
        invitee_id,
        json!({
            "type": "channel_invite_received",
            "channel_id": channel_id,
            "channel_name": channel_name,
            "inviter_username": inviter_username,
        })
        .to_string(),
    );

    Ok(())
}

pub async fn list_my_invites(
    pool: &PgPool,
    user_id: Uuid,
) -> AppResult<Vec<ChannelInviteDetails>> {
    let invites = sqlx::query_as::<_, ChannelInviteDetails>(
        r#"
        SELECT ci.id, ci.channel_id, c.name AS channel_name,
               ci.inviter_id, u.username AS inviter_username,
               ci.status, ci.created_at
        FROM   channel_invites ci
        JOIN   channels c ON c.id = ci.channel_id
        JOIN   users    u ON u.id = ci.inviter_id
        WHERE  ci.invitee_id = $1 AND ci.status = 'pending'
        ORDER  BY ci.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(invites)
}

pub async fn respond_to_invite(
    pool: &PgPool,
    invite_id: Uuid,
    user_id: Uuid,
    accept: bool,
) -> AppResult<()> {
    let row: Option<(Uuid, Uuid, String)> = sqlx::query_as(
        "SELECT channel_id, invitee_id, status FROM channel_invites WHERE id = $1",
    )
    .bind(invite_id)
    .fetch_optional(pool)
    .await?;

    let (channel_id, invitee_id, status) =
        row.ok_or_else(|| AppError::NotFound("Invite not found".into()))?;

    if invitee_id != user_id {
        return Err(AppError::Auth("This invite is not for you".into()));
    }
    if status != "pending" {
        return Err(AppError::Conflict("Invite already resolved".into()));
    }

    let new_status = if accept { "accepted" } else { "rejected" };

    let mut tx = pool.begin().await?;

    sqlx::query("UPDATE channel_invites SET status = $1 WHERE id = $2")
        .bind(new_status)
        .bind(invite_id)
        .execute(&mut *tx)
        .await?;

    if accept {
        sqlx::query(
            "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'member')
             ON CONFLICT DO NOTHING",
        )
        .bind(channel_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}
