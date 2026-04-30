# @dis/store — Zustand Global Store

Centralized client-side state for both frontend apps. Built with [Zustand](https://github.com/pmndrs/zustand) — a minimal, selector-based React state library with zero boilerplate.

---

## Install

Resolved automatically via npm workspaces. Requires `zustand >= 4` as a peer dependency (provided by each app).

```typescript
import { useDisStore } from '@dis/store';
```

---

## Quick Start

```typescript
// Read state (subscribes to changes via selector):
const channels = useDisStore((s) => s.channels);
const user = useDisStore((s) => s.user);
const messages = useDisStore((s) => s.messages[channelId] ?? []);

// Write state:
const setAuth = useDisStore((s) => s.setAuth);
setAuth(token, user);

// Or from outside React:
useDisStore.getState().setChannels(channels);
```

---

## State Shape

### Auth
| Field | Type | Description |
|-------|------|-------------|
| `token` | `string \| null` | JWT token |
| `user` | `User \| null` | Authenticated user |
| `setAuth(token, user)` | action | Set both token and user |
| `clearAuth()` | action | Clear token and user (logout) |

### Channels
| Field | Type | Description |
|-------|------|-------------|
| `channels` | `ChannelSummary[]` | Joined non-DM channels |
| `setChannels(channels)` | action | Replace all channels |
| `addChannel(channel)` | action | Add or update a single channel (deduplicates by ID) |

### DMs
| Field | Type | Description |
|-------|------|-------------|
| `dms` | `ChannelSummary[]` | Direct message channels |
| `setDMs(dms)` | action | Replace all DMs |
| `addDM(dm)` | action | Add a DM (deduplicates by ID) |

### Active Channel
| Field | Type | Description |
|-------|------|-------------|
| `activeChannelId` | `string \| null` | Currently selected channel |
| `setActiveChannel(id)` | action | Switch active channel |

### Messages
| Field | Type | Description |
|-------|------|-------------|
| `messages` | `{ [channelId]: Message[] }` | Per-channel message arrays |
| `setMessages(channelId, messages)` | action | Merge fetched messages (dedup + sort by time) |
| `addMessage(channelId, message)` | action | Append a single message (dedup by ID, replaces pending match) |
| `confirmMessage(channelId, tempId, confirmed)` | action | Replace an optimistic message with the server-confirmed version |

### Social
| Field | Type | Description |
|-------|------|-------------|
| `friends` | `Friend[]` | Accepted friends |
| `setFriends` / `addFriend` | actions | Manage friends list |
| `pendingFriendRequests` | `FriendRequest[]` | Incoming friend requests |
| `setPendingFriendRequests` / `addFriendRequest` / `removeFriendRequest` | actions | Manage friend requests |
| `pendingInvites` | `ChannelInvite[]` | Incoming channel invitations |
| `setPendingInvites` / `addInvite` / `removeInvite` | actions | Manage invites |

### Notifications
| Field | Type | Description |
|-------|------|-------------|
| `socialBadge` | `number` | Total unread social notifications |
| `setSocialBadge` / `incrementSocialBadge` / `clearSocialBadge` | actions | Badge counter |
| `unread` | `Record<string, number>` | Per-channel unread message counts |
| `markUnread(channelId)` | action | Increment unread for a channel |
| `clearUnread(channelId)` | action | Reset unread for a channel |

### WebSocket Status
| Field | Type | Description |
|-------|------|-------------|
| `wsStatus` | `WsStatus` | `'connected' \| 'disconnected' \| 'reconnecting'` |
| `setWsStatus(status)` | action | Update WS connection state |

---

## Pre-built Selectors

For minimal re-renders, use these selector functions:

```typescript
import {
  selectUser,
  selectToken,
  selectChannels,
  selectDMs,
  selectFriends,
  selectActiveChannelId,
  selectWsStatus,
  selectSocialBadge,
  selectMessages,
} from '@dis/store';

// Usage:
const user = useDisStore(selectUser);
const msgs = useDisStore(selectMessages('channel-uuid'));
```

---

## Message Deduplication Logic

The store handles several edge cases to prevent duplicate or stale messages:

1. **`setMessages(channelId, fetched)`** — Merges fetched messages with existing ones. Deduplicates by `id`, then sorts by `created_at`. Used when loading message history.

2. **`addMessage(channelId, message)`** — Skips if a message with the same `id` exists. If the incoming message is server-confirmed (not `pending`) and matches a pending message by `user_id` + `content`, it replaces the pending version.

3. **`confirmMessage(channelId, tempId, confirmed)`** — Finds the optimistic message by `temp_id` and replaces it with the confirmed version. Safety check: won't create a duplicate if the confirmed message already exists.

---

## Design Notes

- **No providers needed** — Zustand stores are module-level singletons; works in React Native and Next.js without a context provider
- **Selector-based subscriptions** — A component that reads `s.channels` won't re-render when `s.messages` changes
- **All state is in-memory** — Token persistence is handled by the app layer (`localStorage` on web, `expo-secure-store` on mobile)
- **`addChannel()` does upsert** — If the channel ID exists, it replaces it; otherwise appends
- **`addDM()` and `addFriend()` are append-only** — They deduplicate but don't update existing entries
