use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Client → Server ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Subscribe { channel_id: Uuid },
    Unsubscribe { channel_id: Uuid },
    SendMessage { channel_id: Uuid, content: String },
    Ping,
}

// ── Server → Client ───────────────────────────────────────────────────────────

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
