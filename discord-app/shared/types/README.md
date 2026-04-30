# @dis/types — Shared TypeScript Interfaces

Pure TypeScript type definitions shared by both frontend apps (`discord-web` and `discord`) and all other `@dis/*` packages. **No runtime code** — only interfaces and type aliases.

---

## Install

This package is resolved automatically via npm workspaces. No separate install needed.

```typescript
import type { User, Channel, Message, ServerMessage } from '@dis/types';
```

---

## Exported Types

### Domain Models

| Type | Description |
|------|-------------|
| `User` | Authenticated user (`id`, `username`, `email`, `created_at`) |
| `Channel` | Chat channel (`name`, `is_public`, `is_direct`, `created_by`, etc.) |
| `ChannelSummary` | Extends `Channel` with `member_count` and `my_role` (joined context) |
| `ChannelMember` | A user within a channel (`user_id`, `username`, `role`, `joined_at`) |
| `Message` | Chat message with optional `pending` / `temp_id` for optimistic UI |
| `Friend` | Accepted friendship (`friend_id`, `username`, `dm_channel_id`) |
| `UserResult` | Lightweight user for search results (`id`, `username`) |

### Social Actions

| Type | Description |
|------|-------------|
| `JoinRequest` | Request to join a private channel (`status`: pending/approved/rejected) |
| `ChannelInvite` | Admin invitation to a channel |
| `FriendRequest` | Pending friend request between two users |

### Auth

| Type | Description |
|------|-------------|
| `AuthResponse` | Login/register response (`{ token: string, user: User }`) |

### WebSocket Protocol

| Type | Direction | Description |
|------|-----------|-------------|
| `ClientMessage` | Client → Server | Union: `subscribe`, `unsubscribe`, `send_message`, `ping` |
| `ServerMessage` | Server → Client | Union: `new_message`, `subscribed`, `unsubscribed`, `pong`, `error`, plus social events |
| `WsStatus` | — | Connection state: `'connected' \| 'disconnected' \| 'reconnecting'` |

### Server → Client Social Events

These arrive via WebSocket as `ServerMessage` variants:

| `type` | When |
|--------|------|
| `channel_invite_received` | Someone invites you to a channel |
| `friend_request_received` | Someone sends you a friend request |
| `friend_request_accepted` | Your friend request was accepted (includes `dm_channel_id`) |
| `join_request_approved` | Your join request for a private channel was approved |
| `join_request_rejected` | Your join request was rejected |

---

## Design Notes

- All IDs are UUIDs (strings), matching the backend's `gen_random_uuid()` PostgreSQL default
- Timestamps are RFC 3339 strings (e.g. `"2024-01-01T00:00:00Z"`)
- `Message.pending` and `Message.temp_id` are client-only fields — the server never sends them
- `ChannelSummary.my_role` is `null` for channels the user hasn't joined (used in discover views)
