use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    errors::{AppError, AppResult},
    models::{
        channel::Channel,
        social::{FriendRequestWithUser, FriendWithUser},
    },
    ws::manager::WsManager,
};

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

    sqlx::query(
        r#"INSERT INTO friend_requests (sender_id, receiver_id)
           VALUES ($1, $2)
           ON CONFLICT (sender_id, receiver_id) DO UPDATE SET status = 'pending'"#,
    )
    .bind(sender_id)
    .bind(receiver_id)
    .execute(pool)
    .await?;

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
) -> AppResult<Vec<FriendRequestWithUser>> {
    let requests = sqlx::query_as::<_, FriendRequestWithUser>(
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
        Some(create_friendship(&mut tx, sender_id, receiver_id).await?)
    } else {
        None
    };

    tx.commit().await?;

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

/// Creates a friendship row + DM channel + memberships in a single transaction.
/// Returns the DM channel ID.
async fn create_friendship(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_a: Uuid,
    user_b: Uuid,
) -> AppResult<Uuid> {
    // Enforce canonical ordering (user_id_1 < user_id_2).
    let (uid1, uid2) = if user_a < user_b {
        (user_a, user_b)
    } else {
        (user_b, user_a)
    };

    let dm_name = format!("dm-{}-{}", uid1, uid2);
    let dm: Channel = sqlx::query_as::<_, Channel>(
        "INSERT INTO channels (id, name, is_public, is_direct)
         VALUES ($1, $2, false, true)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(&dm_name)
    .fetch_one(&mut **tx)
    .await?;

    sqlx::query(
        "INSERT INTO channel_members (channel_id, user_id, role)
         VALUES ($1, $2, 'member'), ($1, $3, 'member')",
    )
    .bind(dm.id)
    .bind(uid1)
    .bind(uid2)
    .execute(&mut **tx)
    .await?;

    sqlx::query(
        "INSERT INTO friends (user_id_1, user_id_2, dm_channel_id) VALUES ($1, $2, $3)",
    )
    .bind(uid1)
    .bind(uid2)
    .bind(dm.id)
    .execute(&mut **tx)
    .await?;

    Ok(dm.id)
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
