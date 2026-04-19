use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// ── Channel membership ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ChannelMember {
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub role: String,
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ChannelMemberWithUser {
    pub user_id: Uuid,
    pub username: String,
    pub role: String,
    pub joined_at: DateTime<Utc>,
}

// ── Join requests ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct JoinRequest {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct JoinRequestWithUser {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub channel_name: String,
    pub user_id: Uuid,
    pub username: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

// ── Channel invites ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ChannelInvite {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub inviter_id: Uuid,
    pub invitee_id: Uuid,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ChannelInviteDetails {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub channel_name: String,
    pub inviter_id: Uuid,
    pub inviter_username: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct InviteUserRequest {
    pub username: String,
}

// ── Friend requests ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct FriendRequest {
    pub id: Uuid,
    pub sender_id: Uuid,
    pub receiver_id: Uuid,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct FriendRequestWithUser {
    pub id: Uuid,
    pub sender_id: Uuid,
    pub sender_username: String,
    pub receiver_id: Uuid,
    pub receiver_username: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SendFriendRequestBody {
    pub username: String,
}

// ── Friends ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Friend {
    pub user_id_1: Uuid,
    pub user_id_2: Uuid,
    pub dm_channel_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

/// A friend as seen by the requesting user — includes their username and DM channel.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct FriendWithUser {
    pub friend_id: Uuid,
    pub username: String,
    pub dm_channel_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}
