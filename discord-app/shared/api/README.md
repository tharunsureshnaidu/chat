# @dis/api — REST API Client

A typed `fetch` wrapper that provides methods for every REST endpoint on the Rust backend. Used by both `discord-web` (Next.js) and `discord` (Expo) — neither app makes raw HTTP calls.

---

## Install

Resolved automatically via npm workspaces.

```typescript
import { ApiClient } from '@dis/api';
```

---

## Quick Start

```typescript
const api = new ApiClient('http://localhost:3000');

// After login:
const { token, user } = await api.login('user@example.com', 'password');
api.setToken(token);

// Now use any authenticated endpoint:
const channels = await api.fetchMyChannels();
const messages = await api.fetchMessages(channelId, 50);
```

---

## Constructor

```typescript
new ApiClient(baseUrl: string)
```

- `baseUrl` — Backend URL, e.g. `http://localhost:3000`. Trailing slash is stripped.

---

## Token Management

| Method | Description |
|--------|-------------|
| `setToken(token)` | Set the JWT for all subsequent requests |
| `getToken()` | Get the current in-memory token |

The client also falls back to `localStorage.getItem('token')` when the in-memory token is `null` (handles Next.js HMR module reload edge case).

---

## Methods

### Auth

| Method | Backend Endpoint | Returns |
|--------|-----------------|---------|
| `login(email, password)` | `POST /api/auth/login` | `AuthResponse` |
| `register(username, email, password)` | `POST /api/auth/register` | `AuthResponse` |

### Channels

| Method | Backend Endpoint | Returns |
|--------|-----------------|---------|
| `fetchMyChannels()` | `GET /api/channels` | `ChannelSummary[]` |
| `fetchMyDMs()` | `GET /api/channels/dms` | `ChannelSummary[]` |
| `getChannel(id)` | `GET /api/channels/:id` | `Channel` |
| `createChannel(name, description?, isPublic?)` | `POST /api/channels` | `Channel` |
| `updateChannel(id, patch)` | `PUT /api/channels/:id` | `Channel` |
| `deleteChannel(id)` | `DELETE /api/channels/:id` | `void` |
| `fetchMembers(channelId)` | `GET /api/channels/:id/members` | `ChannelMember[]` |
| `removeMember(channelId, userId)` | `DELETE /api/channels/:id/members/:uid` | `void` |

### Discover & Search

| Method | Backend Endpoint | Returns |
|--------|-----------------|---------|
| `discoverChannels(query?)` | `GET /api/discover/channels` | `ChannelSummary[]` |
| `searchUsers(query)` | `GET /api/discover/users` | `UserResult[]` |

### Join & Invites

| Method | Backend Endpoint | Returns |
|--------|-----------------|---------|
| `joinChannel(channelId)` | `POST /api/channels/:id/join` | `void` |
| `fetchAllAdminJoinRequests()` | `GET /api/join-requests` | `JoinRequest[]` |
| `fetchJoinRequests(channelId)` | `GET /api/channels/:id/join-requests` | `JoinRequest[]` |
| `respondToJoinRequest(id, approve)` | `POST /api/join-requests/:id` | `void` |
| `inviteUser(channelId, username)` | `POST /api/channels/:id/invite` | `void` |
| `fetchMyInvites()` | `GET /api/invites` | `ChannelInvite[]` |
| `respondToInvite(id, accept)` | `POST /api/invites/:id` | `void` |

### Friends

| Method | Backend Endpoint | Returns |
|--------|-----------------|---------|
| `fetchFriends()` | `GET /api/friends` | `Friend[]` |
| `sendFriendRequest(username)` | `POST /api/friends` | `void` |
| `fetchFriendRequests()` | `GET /api/friend-requests` | `FriendRequest[]` |
| `respondToFriendRequest(id, accept)` | `POST /api/friend-requests/:id` | `void` |

### Messages

| Method | Backend Endpoint | Returns |
|--------|-----------------|---------|
| `fetchMessages(channelId, limit?, beforeId?)` | `GET /api/channels/:id/messages` | `Message[]` |
| `sendMessage(channelId, content)` | `POST /api/channels/:id/messages` | `Message` |

### Presence

| Method | Backend Endpoint | Returns |
|--------|-----------------|---------|
| `getPresence(userId)` | `GET /api/presence/:id` | `{ user_id, online }` |

---

## Error Handling

All methods throw an `Error` on non-2xx responses. The error message is extracted from the response body:

```typescript
try {
  await api.joinChannel(id);
} catch (err) {
  // err.message = "You are already a member" (from backend JSON)
}
```

The client tries to parse `error`, `message`, or raw string from the response body. Falls back to `"HTTP {status}"`.

---

## Design Notes

- All requests include `Content-Type: application/json` and `Authorization: Bearer <token>` (when set)
- 204 responses return `undefined` (no body to parse)
- The class is instantiated once per app as a module-level singleton
- No retry logic — the caller handles retries if needed
