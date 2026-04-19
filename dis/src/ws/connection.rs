use axum::extract::ws::{Message, WebSocket};
use chrono::Utc;
use futures_util::{sink::SinkExt, stream::StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::{debug, error, warn};
use uuid::Uuid;

use sqlx::PgPool;

use crate::{
    config::Config,
    kafka::producer::{KafkaEnvelope, KafkaProducer},
    presence::service as presence,
    services::channel_service,
    ws::manager::WsManager,
};

// ── Client → Server protocol ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Subscribe { channel_id: Uuid },
    Unsubscribe { channel_id: Uuid },
    SendMessage { channel_id: Uuid, content: String },
    Ping,
}

// ── Server → Client protocol ──────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    NewMessage {
        id: Uuid,
        channel_id: Uuid,
        user_id: Uuid,
        username: String,
        content: String,
        timestamp: String,
    },
    Subscribed { channel_id: Uuid },
    Unsubscribed { channel_id: Uuid },
    Pong,
    Error { message: String },
}

impl ServerMessage {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self)
            .unwrap_or_else(|_| r#"{"type":"error","message":"serialization failed"}"#.into())
    }

    pub fn error_json(msg: impl Into<String>) -> String {
        ServerMessage::Error { message: msg.into() }.to_json()
    }
}

// ── Connection lifecycle ──────────────────────────────────────────────────────

pub async fn handle_connection(
    socket: WebSocket,
    user_id: Uuid,
    username: String,
    manager: WsManager,
    kafka: KafkaProducer,
    redis_pool: deadpool_redis::Pool,
    config: Config,
    pool: PgPool,
) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<std::sync::Arc<String>>();

    presence::set_online(&redis_pool, user_id, config.presence_ttl_secs).await;

    let heartbeat_handle = presence::spawn_heartbeat(
        redis_pool.clone(),
        user_id,
        config.presence_heartbeat_secs,
        config.presence_ttl_secs,
    );

    manager.connect(user_id, tx.clone());

    // send task — receives Arc<String> so broadcast only allocates once per
    // message regardless of subscriber count; we clone the inner String here
    // as the final unavoidable step to hand ownership to the WebSocket sink.
    let mut send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(Message::Text((*msg).clone())).await.is_err() {
                break;
            }
        }
        debug!("WS send_task exiting user_id={}", user_id);
    });

    // recv task
    let manager_r = manager.clone();
    let tx_r = tx.clone();
    let username_r = username.clone();

    let mut recv_task = tokio::spawn(async move {
        while let Some(result) = stream.next().await {
            match result {
                Ok(Message::Text(text)) => {
                    let resp = process_message(
                        &text,
                        user_id,
                        &username_r,
                        &manager_r,
                        &kafka,
                        &pool,
                    )
                    .await;

                    if let Some(json) = resp {
                        if tx_r.send(std::sync::Arc::new(json)).is_err() {
                            break;
                        }
                    }
                }
                Ok(Message::Close(_)) | Err(_) => break,
                Ok(_) => {}
            }
        }
        debug!("WS recv_task exiting user_id={}", user_id);
    });

    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }

    heartbeat_handle.abort();
    manager.disconnect(user_id);
    presence::set_offline(&redis_pool, user_id).await;
    debug!("WS connection cleaned up user_id={}", user_id);
}

// ── Message dispatcher ────────────────────────────────────────────────────────

async fn process_message(
    raw: &str,
    user_id: Uuid,
    username: &str,
    manager: &WsManager,
    kafka: &KafkaProducer,
    pool: &PgPool,
) -> Option<String> {
    let client_msg = match serde_json::from_str::<ClientMessage>(raw) {
        Ok(m) => m,
        Err(_) => {
            warn!("WS unparseable message from user_id={}: {}", user_id, raw);
            return Some(ServerMessage::error_json(
                "Invalid message format — expected JSON with a 'type' field",
            ));
        }
    };

    match client_msg {
        ClientMessage::Subscribe { channel_id } => {
            // Single query: fetch visibility + membership in one round-trip.
            let row: Option<(bool, bool)> = sqlx::query_as(
                r#"SELECT c.is_public,
                          EXISTS(
                              SELECT 1 FROM channel_members
                              WHERE channel_id = c.id AND user_id = $2
                          ) AS is_member
                   FROM   channels c
                   WHERE  c.id = $1"#,
            )
            .bind(channel_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .unwrap_or(None);

            match row {
                None => {
                    return Some(ServerMessage::error_json("Channel not found"));
                }
                Some((false, false)) => {
                    return Some(ServerMessage::error_json(
                        "You must be a member to subscribe to this private channel",
                    ));
                }
                _ => {}
            }

            manager.subscribe(user_id, channel_id);
            Some(ServerMessage::Subscribed { channel_id }.to_json())
        }

        ClientMessage::Unsubscribe { channel_id } => {
            manager.unsubscribe(user_id, channel_id);
            Some(ServerMessage::Unsubscribed { channel_id }.to_json())
        }

        ClientMessage::SendMessage { channel_id, content } => {
            // Fast path: if the user has already subscribed to this channel in
            // this session, the subscription itself enforced the membership
            // check — no extra DB query needed.
            if !manager.is_subscribed(user_id, channel_id)
                && !channel_service::is_member(pool, channel_id, user_id).await
            {
                return Some(ServerMessage::error_json(
                    "You must be a member of this channel to send messages",
                ));
            }

            let content = content.trim().to_string();
            if content.is_empty() {
                return Some(ServerMessage::error_json("Message content cannot be empty"));
            }
            if content.len() > 4000 {
                return Some(ServerMessage::error_json("Message content exceeds 4 000-character limit"));
            }

            let envelope = KafkaEnvelope {
                id: Uuid::new_v4(),
                channel_id,
                user_id,
                username: username.to_string(),
                content,
                timestamp: Utc::now().to_rfc3339(),
            };

            if let Err(e) = kafka.publish(&envelope).await {
                error!("WS send_message kafka error: {:?}", e);
                return Some(ServerMessage::error_json("Failed to queue message — try again"));
            }

            // Acknowledgement is not sent here; the Kafka consumer will publish
            // to Redis Pub/Sub which echoes the message back to all subscribers
            // (including the sender) once it is persisted.
            None
        }

        ClientMessage::Ping => Some(ServerMessage::Pong.to_json()),
    }
}
