// ─── Domain models ────────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  email: string;
  created_at: string;
}

export interface Channel {
  id: string;
  name: string;
  description?: string | null;
  is_public: boolean;
  is_direct: boolean;
  created_by?: string | null;
  created_at: string;
}

export interface ChannelSummary extends Channel {
  member_count: number;
  my_role?: string | null;
}

export interface ChannelMember {
  user_id: string;
  username: string;
  role: string;
  joined_at: string;
}

export interface JoinRequest {
  id: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  username: string;
  status: string;
  created_at: string;
}

export interface ChannelInvite {
  id: string;
  channel_id: string;
  channel_name: string;
  inviter_id: string;
  inviter_username: string;
  status: string;
  created_at: string;
}

export interface FriendRequest {
  id: string;
  sender_id: string;
  sender_username: string;
  receiver_id: string;
  receiver_username: string;
  status: string;
  created_at: string;
}

export interface Friend {
  friend_id: string;
  username: string;
  dm_channel_id?: string | null;
  created_at: string;
}

export interface UserResult {
  id: string;
  username: string;
}

/**
 * A message as returned by REST (GET /channels/:id/messages).
 * `pending` and `temp_id` are client-only fields used for optimistic updates.
 */
export interface Message {
  id: string;
  channel_id: string;
  user_id: string;
  username: string;
  content: string;
  created_at: string;
  /** True while the message is being sent (optimistic UI) */
  pending?: boolean;
  /** Local dedup key for optimistic messages */
  temp_id?: string;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthResponse {
  token: string;
  user: User;
}

// ─── WebSocket — client → server ──────────────────────────────────────────────

export type ClientMessage =
  | { type: 'subscribe'; channel_id: string }
  | { type: 'unsubscribe'; channel_id: string }
  | { type: 'send_message'; channel_id: string; content: string }
  | { type: 'ping' };

// ─── WebSocket — server → client ──────────────────────────────────────────────

export type ServerMessage =
  | {
      type: 'new_message';
      id: string;
      channel_id: string;
      user_id: string;
      username: string;
      content: string;
      /** RFC3339 datetime string */
      timestamp: string;
    }
  | { type: 'subscribed'; channel_id: string }
  | { type: 'unsubscribed'; channel_id: string }
  | { type: 'pong' }
  | { type: 'error'; message: string }
  // ── Social events ────────────────────────────────────────────────────────────
  | {
      type: 'channel_invite_received';
      channel_id: string;
      channel_name: string;
      inviter_username: string;
    }
  | {
      type: 'friend_request_received';
      sender_id: string;
      sender_username: string;
    }
  | { type: 'join_request_approved'; channel_id: string }
  | { type: 'join_request_rejected'; channel_id: string }
  | {
      type: 'friend_request_accepted';
      friend_id: string;
      friend_username: string;
      dm_channel_id: string | null;
    };

// ─── WebSocket connection status ──────────────────────────────────────────────

export type WsStatus = 'connected' | 'disconnected' | 'reconnecting';
