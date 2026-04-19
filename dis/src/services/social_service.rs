use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    errors::{AppError, AppResult},
    models::{
        channel::{Channel, ChannelSummary},
        social::{
            ChannelInviteDetails, ChannelMemberWithUser, FriendRequest, FriendWithUser,
            JoinRequestWithUser,
        },
    },
    ws::manager::WsManager,
};

// ── Members ───────────────────────────────────────────────────────────────────

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
    // Allow self-leave or admin kick
    if caller_id != target_id {
        super::channel_service::require_admin(pool, channel_id, caller_id).await?;
    }

    sqlx::query("DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2")
        .bind(channel_id)
        .bind(target_id)
        .execute(pool)
        .await?;

    Ok(())
}

// ── Discover ──────────────────────────────────────────────────────────────────

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

// ── Join requests ─────────────────────────────────────────────────────────────

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
        // Direct join for public channels
        sqlx::query(
            "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'member')
             ON CONFLICT DO NOTHING",
        )
        .bind(channel_id)
        .bind(user_id)
        .execute(pool)
        .await?;
    } else {
        // Private — create join request
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
    super::channel_service::require_admin(pool, channel_id, caller_id).await?;

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

    super::channel_service::require_admin(pool, channel_id, admin_id).await?;

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

    // Notify requester
    let event = if approve {
        json!({ "type": "join_request_approved", "channel_id": channel_id })
    } else {
        json!({ "type": "join_request_rejected", "channel_id": channel_id })
    };
    ws.send_to(requester_id, event.to_string());

    Ok(())
}

// ── Channel invites ───────────────────────────────────────────────────────────

pub async fn invite_user(
    pool: &PgPool,
    ws: &WsManager,
    channel_id: Uuid,
    inviter_id: Uuid,
    username: &str,
) -> AppResult<()> {
    super::channel_service::require_admin(pool, channel_id, inviter_id).await?;

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

    // Fetch channel name + inviter username in a single query (both are already
    // verified to exist — require_admin passed and the invite INSERT succeeded).
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

// ── Friend requests ───────────────────────────────────────────────────────────

pub async fn send_friend_request(
    pool: &PgPool,
    ws: &WsManager,
    sender_id: Uuid,
    sender_username: &str,
    username: &str,
) -> AppResult<()> {
    let target: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM users WHERE username = $1")
            .bind(username)
            .fetch_optional(pool)
            .await?;

    let (receiver_id,) =
        target.ok_or_else(|| AppError::NotFound(format!("User '{username}' not found")))?;

    if receiver_id == sender_id {
        return Err(AppError::Validation("Cannot send a friend request to yourself".into()));
    }

    let already_friends: bool = sqlx::query_scalar(
        r#"SELECT EXISTS(
            SELECT 1 FROM friends
            WHERE (user_id_1 = $1 AND user_id_2 = $2)
               OR (user_id_1 = $2 AND user_id_2 = $1)
        )"#,
    )
    .bind(sender_id)
    .bind(receiver_id)
    .fetch_one(pool)
    .await?;

    if already_friends {
        return Err(AppError::Conflict("You are already friends".into()));
    }

    // Upsert: if rejected before, re-send
    sqlx::query(
        r#"INSERT INTO friend_requests (sender_id, receiver_id)
           VALUES ($1, $2)
           ON CONFLICT (sender_id, receiver_id) DO UPDATE SET status = 'pending'"#,
    )
    .bind(sender_id)
    .bind(receiver_id)
    .execute(pool)
    .await?;

    // sender_username comes from the caller (JWT) — no extra DB query needed.
    ws.send_to(
        receiver_id,
        json!({
            "type": "friend_request_received",
            "sender_id": sender_id,
            "sender_username": sender_username,
        })
        .to_string(),
    );

    Ok(())
}

pub async fn list_friend_requests(
    pool: &PgPool,
    user_id: Uuid,
) -> AppResult<Vec<crate::models::social::FriendRequestWithUser>> {
    let requests = sqlx::query_as::<_, crate::models::social::FriendRequestWithUser>(
        r#"
        SELECT fr.id, fr.sender_id, s.username AS sender_username,
               fr.receiver_id, r.username AS receiver_username,
               fr.status, fr.created_at
        FROM   friend_requests fr
        JOIN   users s ON s.id = fr.sender_id
        JOIN   users r ON r.id = fr.receiver_id
        WHERE  fr.receiver_id = $1 AND fr.status = 'pending'
        ORDER  BY fr.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(requests)
}

pub async fn respond_to_friend_request(
    pool: &PgPool,
    ws: &WsManager,
    request_id: Uuid,
    receiver_id: Uuid,
    accept: bool,
) -> AppResult<()> {
    let row: Option<(Uuid, Uuid, String)> = sqlx::query_as(
        "SELECT sender_id, receiver_id, status FROM friend_requests WHERE id = $1",
    )
    .bind(request_id)
    .fetch_optional(pool)
    .await?;

    let (sender_id, actual_receiver, status) =
        row.ok_or_else(|| AppError::NotFound("Friend request not found".into()))?;

    if actual_receiver != receiver_id {
        return Err(AppError::Auth("This request is not for you".into()));
    }
    if status != "pending" {
        return Err(AppError::Conflict("Request already resolved".into()));
    }

    let new_status = if accept { "accepted" } else { "rejected" };

    let mut tx = pool.begin().await?;

    sqlx::query("UPDATE friend_requests SET status = $1 WHERE id = $2")
        .bind(new_status)
        .bind(request_id)
        .execute(&mut *tx)
        .await?;

    let dm_channel_id = if accept {
        // Create the friendship (enforce user_id_1 < user_id_2 ordering)
        let (uid1, uid2) = if sender_id < receiver_id {
            (sender_id, receiver_id)
        } else {
            (receiver_id, sender_id)
        };

        // Create DM channel
        let dm_name = format!("dm-{}-{}", uid1, uid2);
        let dm: Channel = sqlx::query_as::<_, Channel>(
            "INSERT INTO channels (id, name, is_public, is_direct)
             VALUES ($1, $2, false, true)
             RETURNING *",
        )
        .bind(Uuid::new_v4())
        .bind(&dm_name)
        .fetch_one(&mut *tx)
        .await?;

        // Add both as members
        sqlx::query(
            "INSERT INTO channel_members (channel_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member')",
        )
        .bind(dm.id)
        .bind(uid1)
        .bind(uid2)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO friends (user_id_1, user_id_2, dm_channel_id) VALUES ($1, $2, $3)",
        )
        .bind(uid1)
        .bind(uid2)
        .bind(dm.id)
        .execute(&mut *tx)
        .await?;

        Some(dm.id)
    } else {
        None
    };

    tx.commit().await?;

    // Notify the sender
    if accept {
        let receiver_username: Option<String> =
            sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
                .bind(receiver_id)
                .fetch_optional(pool)
                .await?;

        ws.send_to(
            sender_id,
            json!({
                "type": "friend_request_accepted",
                "friend_id": receiver_id,
                "friend_username": receiver_username,
                "dm_channel_id": dm_channel_id,
            })
            .to_string(),
        );
    }

    Ok(())
}

pub async fn list_friends(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<FriendWithUser>> {
    let friends = sqlx::query_as::<_, FriendWithUser>(
        r#"
        SELECT
            CASE WHEN f.user_id_1 = $1 THEN f.user_id_2 ELSE f.user_id_1 END AS friend_id,
            u.username,
            f.dm_channel_id,
            f.created_at
        FROM   friends f
        JOIN   users u ON u.id = CASE WHEN f.user_id_1 = $1 THEN f.user_id_2 ELSE f.user_id_1 END
        WHERE  f.user_id_1 = $1 OR f.user_id_2 = $1
        ORDER  BY u.username ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(friends)
}

// ── User search ───────────────────────────────────────────────────────────────

pub async fn search_users(
    pool: &PgPool,
    query: &str,
    caller_id: Uuid,
) -> AppResult<Vec<serde_json::Value>> {
    let users: Vec<(Uuid, String)> = sqlx::query_as(
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
        .map(|(id, username)| json!({ "id": id, "username": username }))
        .collect())
}
