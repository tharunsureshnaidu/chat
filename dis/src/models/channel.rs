use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Channel {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub is_public: bool,
    pub created_by: Option<Uuid>,
    pub is_direct: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    pub description: Option<String>,
    #[serde(default = "default_true")]
    pub is_public: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
pub struct UpdateChannelRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub is_public: Option<bool>,
}

/// Channel row joined with member count — used in discovery and channel list.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ChannelSummary {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub is_public: bool,
    pub is_direct: bool,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub member_count: i64,
    /// Caller's role in this channel, None if not a member.
    pub my_role: Option<String>,
}
