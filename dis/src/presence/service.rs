//! Presence service — tracks which users are online using Redis.
//!
//! Each connected user has a key  `presence:user:{user_id}`  with a short TTL.
//! As long as the user holds an open WebSocket the heartbeat task refreshes
//! the TTL periodically, preventing the key from expiring.  On disconnect the
//! key is deleted immediately.
//!
//! Any server instance (or external service) can check whether a user is online
//! by testing whether the key exists in Redis.

use tracing::{debug, warn};
use uuid::Uuid;

/// Format the Redis key for a given user.
#[inline]
fn presence_key(user_id: Uuid) -> String {
    format!("presence:user:{}", user_id)
}

/// Mark a user as online.  Sets `presence:user:{user_id}` with the given TTL.
pub async fn set_online(pool: &deadpool_redis::Pool, user_id: Uuid, ttl_secs: u64) {
    let key = presence_key(user_id);
    let mut conn = match pool.get().await {
        Ok(c) => c,
        Err(e) => { warn!("Presence: pool checkout failed (set_online) user_id={}: {}", user_id, e); return; }
    };
    let result: redis::RedisResult<()> = redis::AsyncCommands::set_ex(&mut *conn, &key, "1", ttl_secs).await;
    match result {
        Ok(_) => debug!("Presence: set online user_id={}", user_id),
        Err(e) => warn!("Presence: set_online failed for user_id={}: {}", user_id, e),
    }
}

/// Refresh the TTL on a user's presence key (heartbeat).
pub async fn refresh(pool: &deadpool_redis::Pool, user_id: Uuid, ttl_secs: u64) {
    let key = presence_key(user_id);
    let mut conn = match pool.get().await {
        Ok(c) => c,
        Err(e) => { warn!("Presence: pool checkout failed (refresh) user_id={}: {}", user_id, e); return; }
    };
    let result: redis::RedisResult<bool> = redis::AsyncCommands::expire(&mut *conn, &key, ttl_secs as i64).await;
    match result {
        Ok(true) => debug!("Presence: refreshed user_id={}", user_id),
        Ok(false) => {
            // Key expired between heartbeats — re-create it.
            debug!("Presence: key expired, re-creating for user_id={}", user_id);
            drop(conn); // return conn to pool before the recursive call
            set_online(pool, user_id, ttl_secs).await;
        }
        Err(e) => warn!("Presence: refresh failed for user_id={}: {}", user_id, e),
    }
}

/// Remove a user's presence key immediately (called on disconnect).
pub async fn set_offline(pool: &deadpool_redis::Pool, user_id: Uuid) {
    let key = presence_key(user_id);
    let mut conn = match pool.get().await {
        Ok(c) => c,
        Err(e) => { warn!("Presence: pool checkout failed (set_offline) user_id={}: {}", user_id, e); return; }
    };
    let result: redis::RedisResult<()> = redis::AsyncCommands::del(&mut *conn, &key).await;
    match result {
        Ok(_) => debug!("Presence: set offline user_id={}", user_id),
        Err(e) => warn!("Presence: set_offline failed for user_id={}: {}", user_id, e),
    }
}

/// Returns `true` if the user currently has an active presence key in Redis.
pub async fn is_online(pool: &deadpool_redis::Pool, user_id: Uuid) -> bool {
    let key = presence_key(user_id);
    let mut conn = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            warn!("Presence: pool checkout failed (is_online) user_id={}: {}", user_id, e);
            return false;
        }
    };
    let result: redis::RedisResult<bool> = redis::AsyncCommands::exists(&mut *conn, &key).await;
    result.unwrap_or_else(|e| {
        warn!("Presence: is_online check failed for user_id={}: {}", user_id, e);
        false
    })
}

/// Spawn a background Tokio task that refreshes the presence TTL for `user_id`
/// every `heartbeat_secs` seconds until the task is aborted.
///
/// Caller is responsible for aborting the task on disconnect.
pub fn spawn_heartbeat(
    pool: deadpool_redis::Pool,
    user_id: Uuid,
    heartbeat_secs: u64,
    ttl_secs: u64,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let interval = std::time::Duration::from_secs(heartbeat_secs);
        loop {
            tokio::time::sleep(interval).await;
            refresh(&pool, user_id, ttl_secs).await;
        }
    })
}
