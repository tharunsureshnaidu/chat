//! Redis Pub/Sub bridge.
//!
//! # Publishing
//! When a user sends a message it is saved to PostgreSQL and then published to
//! the Redis channel  `chat:channel:{channel_id}`.  Publishing is done through
//! a `ConnectionManager` (multiplexed, auto-reconnecting async connection).
//!
//! # Subscribing
//! A single long-running Tokio task (`run_subscriber`) opens a *dedicated*
//! Redis pub/sub connection (pub/sub connections cannot be shared for regular
//! commands), subscribes to `chat:channel:*` using a pattern subscription, and
//! forwards every incoming message to the local `WsManager` which delivers it
//! to locally connected WebSocket clients.
//!
//! This design means every server instance receives every published message and
//! fans it out only to the clients that are locally connected and subscribed to
//! that channel — the correct multi-server behaviour.
//!
//! Pool creation / health check utilities live in `crate::redis::pool`.

// Re-export pool utilities so existing call-sites keep working.
pub use crate::redis::pool::{create_and_verify_pool, ping};

use redis::{AsyncCommands, Client};
use serde::{Deserialize, Serialize};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::ws::manager::WsManager;

// ── Shared message envelope ───────────────────────────────────────────────────

/// The JSON payload published to / received from Redis.
/// This is **not** the same as the WebSocket protocol envelope — it carries
/// the data needed to reconstruct a `ServerMessage::NewMessage` on the
/// receiving side.
#[derive(Debug, Serialize, Deserialize)]
pub struct RedisChatMessage {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub username: String,
    pub content: String,
    pub timestamp: String,
}

impl RedisChatMessage {
    /// Serialize for publishing.
    pub fn to_json(&self) -> Option<String> {
        serde_json::to_string(self).ok()
    }

    /// Deserialize from a raw Redis payload string.
    pub fn from_json(s: &str) -> Option<Self> {
        serde_json::from_str(s).ok()
    }

    /// Build the WebSocket `new_message` JSON that clients expect.
    pub fn to_ws_payload(&self) -> String {
        serde_json::json!({
            "type":       "new_message",
            "id":         self.id,
            "channel_id": self.channel_id,
            "user_id":    self.user_id,
            "username":   self.username,
            "content":    self.content,
            "timestamp":  self.timestamp,
        })
        .to_string()
    }
}

// ── Redis channel naming ──────────────────────────────────────────────────────

pub fn redis_channel_name(channel_id: Uuid) -> String {
    format!("chat:channel:{}", channel_id)
}

// ── Publisher helper ──────────────────────────────────────────────────────────

/// Publish a chat message to the Redis channel for `channel_id`.
/// Acquires a pooled connection — true concurrent publish without serialisation.
pub async fn publish(pool: &deadpool_redis::Pool, msg: &RedisChatMessage) {
    let channel = redis_channel_name(msg.channel_id);
    let payload = match msg.to_json() {
        Some(p) => p,
        None => {
            warn!("Redis publish: failed to serialize message id={}", msg.id);
            return;
        }
    };

    let mut conn = match pool.get().await {
        Ok(c) => c,
        Err(e) => {
            error!("Redis publish: pool checkout failed: {}", e);
            return;
        }
    };

    let result: redis::RedisResult<()> = conn.publish(&channel, &payload).await;
    match result {
        Ok(_) => debug!("Redis: published to channel={}", channel),
        Err(e) => error!("Redis: publish failed on channel={}: {}", channel, e),
    }
}

// ── Subscriber task ───────────────────────────────────────────────────────────

/// Open a dedicated pub/sub connection and forward all `chat:channel:*`
/// messages to the `WsManager` for local fanout.
///
/// This function never returns under normal operation — it should be spawned
/// with `tokio::spawn`.  On Redis errors it retries with a back-off.
pub async fn run_subscriber(redis_url: String, manager: WsManager) {
    info!("Redis subscriber starting (url={})", redis_url);

    loop {
        match try_subscribe(redis_url.clone(), manager.clone()).await {
            Ok(_) => {
                warn!("Redis subscriber connection closed — reconnecting in 2s");
            }
            Err(e) => {
                error!("Redis subscriber error: {} — reconnecting in 2s", e);
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}

async fn try_subscribe(
    redis_url: String,
    manager: WsManager,
) -> Result<(), redis::RedisError> {
    let client = Client::open(redis_url)?;
    let mut pubsub = client.get_async_pubsub().await?;

    // Pattern subscription — catches every channel regardless of which
    // channels the current server's clients happen to be using.
    pubsub.psubscribe("chat:channel:*").await?;
    info!("Redis subscriber: listening on pattern chat:channel:*");

    use futures_util::StreamExt;
    let mut stream = pubsub.into_on_message();

    while let Some(msg) = stream.next().await {
        let payload: String = match msg.get_payload() {
            Ok(p) => p,
            Err(e) => {
                warn!("Redis subscriber: bad payload: {}", e);
                continue;
            }
        };

        let chat_msg = match RedisChatMessage::from_json(&payload) {
            Some(m) => m,
            None => {
                warn!("Redis subscriber: failed to deserialize payload: {}", payload);
                continue;
            }
        };

        debug!(
            "Redis subscriber: received message id={} for channel_id={}",
            chat_msg.id, chat_msg.channel_id
        );

        // Forward to all locally connected clients subscribed to this channel.
        manager.broadcast(chat_msg.channel_id, chat_msg.to_ws_payload(), None);
    }

    Ok(())
}
