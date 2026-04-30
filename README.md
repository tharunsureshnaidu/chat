# dis — Real-Time Chat Platform

A Discord-inspired real-time chat platform with a **Rust backend** and **two frontend apps** (web + mobile) that share all business logic via a monorepo.

---

## Overview

```
chat/
├── dis/              ← Rust backend (Axum + PostgreSQL + Redis + Kafka)
└── discord-app/      ← Frontend monorepo (npm workspaces)
    ├── shared/       ← Shared TypeScript packages (@dis/types, @dis/api, @dis/ws, @dis/store)
    ├── discord-web/  ← Next.js 16 web app (browser)
    └── discord/      ← Expo SDK 54 mobile app (iOS, Android, web)
```

| Component | Tech Stack | Port |
|-----------|-----------|------|
| Backend | Rust, Axum, PostgreSQL, Redis, Kafka | 3000 |
| Web app | Next.js 16, React 19, Tailwind CSS v4, Zustand | 3001 |
| Mobile app | Expo 54, React Native 0.81, Zustand | 8081 |

---

## How Everything Connects

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Rust Backend (:3000)                        │
│                                                                     │
│  Axum HTTP + WebSocket server                                       │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌────────────────┐   │
│  │  REST    │   │   Auth   │   │ Business │   │   WebSocket    │   │
│  │ Handlers │   │Middleware│   │ Services │   │   Manager      │   │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └───────┬────────┘   │
│       └───────────────┴──────────────┴─────────────────┘            │
│                           AppState                                  │
│         PgPool · Redis Pool · WsManager · KafkaProducer             │
└──────────┬──────────────────┬──────────────────┬────────────────────┘
           │                  │                  │
      PostgreSQL           Redis              Kafka
      (users,            (pub/sub,           (message
       channels,          presence,           queue,
       messages)          dedup)              ordering)
           ▲                  ▲                  ▲
           │                  │                  │
          REST              WebSocket          WebSocket
     (HTTP JSON)        (ws://?token=jwt)    (send_message
           │                  │               → Kafka topic)
           │                  │
  ┌────────┴──────────────────┴──────────┐
  │           shared/ packages           │
  │  @dis/api    @dis/ws    @dis/store   │
  │          @dis/types                  │
  └────────┬──────────────────┬──────────┘
           │                  │
    discord-web/          discord/
   (Next.js :3001)     (Expo :8081)
```

Both frontends use the **exact same** shared packages — zero duplicated logic.

---

## The Message Pipeline (End to End)

This is the core flow. Understanding this is understanding the entire system.

```
1. User types "hello" in MessageInput → presses Enter
2. WsClient.sendMessage(channelId, "hello")
   → sends JSON: { type: "send_message", channel_id: "...", content: "hello" }
   → over WebSocket to Rust backend

3. Backend (ws/connection.rs):
   → validates channel membership
   → wraps in KafkaEnvelope (UUID, timestamp)
   → publishes to Kafka topic "chat_messages" (partitioned by channel_id)

4. Kafka Consumer 1 (persistence):
   → Redis SET NX EX dedup (prevents duplicate processing)
   → INSERT INTO messages (PostgreSQL)
   → Publish to Redis channel "chat:channel:{channel_id}"

5. Redis Pub/Sub (ws/redis_pubsub.rs):
   → Pattern-subscribes to "chat:channel:*"
   → On message: calls WsManager.broadcast(channel_id, message)

6. WsManager fans out to all WebSocket clients subscribed to that channel
   → Client A, B, C ... all receive: { type: "new_message", id: "...", content: "hello" }

7. Frontend (both apps):
   → useDisStore.addMessage(channelId, message)
   → deduplicates by message ID
   → ChatWindow re-renders → message appears
```

### Why Kafka in the middle?

- **Decouples send from persist** — WS handler returns instantly, doesn't wait for DB
- **Guarantees ordering** — messages partitioned by channel_id → same channel = same partition = ordered
- **Enables multi-server** — multiple backend instances can consume independently
- **Durability** — 7-day retention, messages survive server restarts

### Why Redis Pub/Sub for fanout?

- If you run 5 backend instances, each subscribes to `chat:channel:*`
- A message persisted by instance #2 gets published to Redis → ALL instances receive it → forward to their local WebSocket clients
- This is what makes horizontal scaling work

---

## Backend (`dis/`)

Full-featured Rust chat server. See [`dis/README.md`](dis/README.md) for the complete deep-dive.

### Infrastructure

| Service | Purpose |
|---------|---------|
| **PostgreSQL** | Durable storage: users, channels, messages, friendships, memberships |
| **Redis** | In-memory: cross-instance pub/sub, presence TTL keys, Kafka message dedup |
| **Kafka** | Durable ordered message queue, decouples send from persist + broadcast |

### Features

- Channels (public, private, DM), with admin roles and membership
- Real-time messaging via WebSocket (subscribe/unsubscribe per channel)
- Cursor-based message pagination (scroll-up loads older messages)
- Friend requests, channel invites, join requests — all with real-time WS notifications
- Presence tracking (online/offline via Redis TTL keys)
- User + channel search (PostgreSQL trigram indexes for fast `ILIKE` queries)
- JWT auth (Argon2 password hashing, HS256 tokens, anti-enumeration)
- Graceful shutdown (SIGTERM, Ctrl+C)
- Health endpoint (`/health`) checks PostgreSQL + Redis

### REST API (abridged)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Get JWT |
| GET | `/api/channels` | List my channels |
| POST | `/api/channels` | Create channel |
| GET | `/api/channels/:id/messages` | Fetch history (cursor-paginated) |
| POST | `/api/channels/:id/messages` | Send via Kafka |
| POST | `/api/channels/:id/join` | Join (public) or request (private) |
| POST | `/api/channels/:id/invite` | Invite user (admin) |
| POST | `/api/friends` | Send friend request |
| GET | `/api/discover/channels` | Browse public channels |
| GET | `/api/discover/users` | Search users |
| GET | `/api/presence/:user_id` | Online/offline status |

Full API reference in [`dis/README.md`](dis/README.md).

### WebSocket Protocol

Connect: `ws://host:3000/ws?token=<jwt>`

**Client → Server:**
```json
{ "type": "subscribe",    "channel_id": "uuid" }
{ "type": "unsubscribe",  "channel_id": "uuid" }
{ "type": "send_message", "channel_id": "uuid", "content": "hello" }
{ "type": "ping" }
```

**Server → Client:**
```json
{ "type": "new_message", "id": "uuid", "channel_id": "uuid", "user_id": "uuid",
  "username": "alice",   "content": "hello", "timestamp": "2024-01-01T00:00:00Z" }
{ "type": "subscribed",    "channel_id": "uuid" }
{ "type": "pong" }
{ "type": "error",         "message": "..." }
{ "type": "friend_request_received",   "sender_id": "uuid", "sender_username": "alice" }
{ "type": "channel_invite_received",   "channel_id": "uuid", "channel_name": "general", "inviter_username": "alice" }
{ "type": "friend_request_accepted",   "friend_id": "uuid", "friend_username": "bob", "dm_channel_id": "uuid" }
{ "type": "join_request_approved",     "channel_id": "uuid" }
```

---

## Frontend Monorepo (`discord-app/`)

See [`discord-app/README.md`](discord-app/README.md) for the full frontend guide.

### Shared Packages (`shared/`)

All business logic lives here — neither app contains any HTTP or WebSocket code.

| Package | What It Does |
|---------|-------------|
| `@dis/types` | TypeScript interfaces: `User`, `Channel`, `Message`, `ServerMessage`, `ClientMessage`, `WsStatus`. No runtime code. |
| `@dis/api` | `ApiClient` class — wraps `fetch`, injects JWT, provides methods for every REST endpoint |
| `@dis/ws` | `WsClient` class — WebSocket with auto-reconnect (exponential back-off 1s→30s + jitter), heartbeat pings (25s), subscription tracking (restored on reconnect) |
| `@dis/store` | Zustand store (`useDisStore`) — auth, channels, DMs, messages (per-channel with merge/dedup), friends, invites, unread counts, WS status |

```typescript
// Example usage (identical in both apps):
const api = new ApiClient('http://localhost:3000');
api.setToken(jwt);
const channels = await api.fetchMyChannels();

const ws = new WsClient({ wsUrl, token, onMessage, onStatus });
ws.connect();
ws.subscribe(channelId);

const messages = useDisStore(s => s.messages[channelId] ?? []);
```

### Web App (`discord-web/`)

See [`discord-web/README.md`](discord-app/discord-web/README.md).

- Next.js 16, React 19, Tailwind CSS v4
- Virtualised chat with `@tanstack/react-virtual`
- Full social UI: discover channels, friend requests, channel invites, user search
- Token in `localStorage`

### Mobile App (`discord/`)

See [`discord/README.md`](discord-app/discord/README.md).

- Expo SDK 54, React Native 0.81
- Native `FlatList` for chat (already virtualised)
- WS disconnects on app background, reconnects on foreground
- Token in `expo-secure-store` (encrypted)

### Web vs. Mobile

| Feature | Web | Mobile |
|---------|-----|--------|
| Chat virtualisation | `@tanstack/react-virtual` | `FlatList` (native) |
| Token storage | `localStorage` | `expo-secure-store` (encrypted) |
| Social features | Full (discover, invites, friends, search) | Basic (channels + chat) |
| WS on background | Stays connected | Disconnects (saves battery) |
| Styling | Tailwind CSS v4 | React Native StyleSheet |

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | >= 18 | Frontend JavaScript runtime |
| npm | >= 9 | Package manager (workspaces) |
| Rust + Cargo | stable | Backend |
| PostgreSQL | >= 14 | Message persistence |
| Docker | any recent | Redis + Kafka containers |

---

## Quick Start

### 1. Start infrastructure

```bash
# PostgreSQL (systemd)
sudo systemctl start postgresql

# Redis + Kafka (Docker)
cd dis/
docker compose up -d
```

### 2. Start the backend

```bash
cd dis/

# First time: create .env from template
cp .env.example .env
# Set: DATABASE_URL, JWT_SECRET (required)
# Defaults work for: REDIS_URL, KAFKA_BROKERS

cargo run
# → http://localhost:3000
# → ws://localhost:3000/ws
```

### 3. Install frontend dependencies

```bash
cd discord-app/
npm install
```

### 4. Configure environment

**Web** — `discord-app/discord-web/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3000/ws
```

**Mobile** — `discord-app/discord/.env`:
```
EXPO_PUBLIC_API_URL=http://192.168.x.x:3000
EXPO_PUBLIC_WS_URL=ws://192.168.x.x:3000/ws
```

> Mobile devices cannot reach `localhost`. Use your machine's LAN IP: `ip addr show`

### 5. Run the frontends

```bash
cd discord-app/

# Web (opens at http://localhost:3001):
npm run dev:web

# Mobile (separate terminal):
npm run dev:mobile
```

---

## Architecture Decisions

### Why a monorepo with `shared/`?

Without shared packages, the same API and WebSocket logic would be duplicated in both apps. A bug fix in one doesn't fix the other. With `shared/`, every fix applies to both instantly.

### Why Zustand?

Zero boilerplate (no actions, reducers, providers). Selector-based subscriptions mean components only re-render when their slice changes. Works identically in React and React Native.

### Why no optimistic updates?

The backend broadcasts every sent message back to the sender via Redis Pub/Sub. Round-trip is typically <100ms locally. The WS echo is the single source of truth for all messages.

### Why virtualised lists?

Chat windows can have thousands of messages. Without virtualisation, rendering them all causes severe memory and paint performance issues. Web uses `@tanstack/react-virtual`, mobile uses `FlatList` (natively virtualised).

### Why is the JWT in the WebSocket URL?

Browsers don't allow custom headers on WebSocket connections. The JWT goes in the query string. The backend validates it before completing the HTTP→WS upgrade — invalid tokens get a 401 response.

### Why exponential back-off with jitter?

If 1000 users disconnect at once (server restart), they'd all reconnect at the same second without jitter — thundering herd. Jitter (0.75–1.25x random multiplier) spreads reconnections over time.

### Why Kafka between send and persist?

Decouples the hot path (WS handler returns instantly) from the slow path (DB write). Provides ordering guarantees within a channel (partitioned by channel_id). Enables independent consumer groups (persistence vs. notifications).

### Why Redis for dedup?

Kafka delivers at-least-once. `SET NX EX` atomically claims a message ID — if it was already claimed, skip. No TOCTOU race. 24h TTL auto-cleans.

---

## Common Issues

| Problem | Fix |
|---------|-----|
| `Connection refused` on Redis | `docker compose up -d` in `dis/` |
| `Connection refused` on PostgreSQL | `sudo systemctl start postgresql` |
| `authentication failed` | Check `DATABASE_URL` in `dis/.env` |
| Kafka broker unreachable | `docker compose up -d` in `dis/` |
| `@dis/store` not found | Run `npm install` from `discord-app/`, not from inside an app |
| Mobile can't connect | Use LAN IP in `.env`, not `localhost` |
| Port 3000 in use | Backend uses 3000; Next.js auto-picks 3001 |
| Stale shared code | `rm -rf discord-web/.next && npm run dev:web` |
| Messages not appearing | Both windows must be subscribed to the same channel |

---

## Load Testing

Uses [k6](https://k6.io/). Scripts are in `dis/load-tests/`.

```bash
# Install k6 first, then:

# Stage 1 — Baseline (~90s)
k6 run --env VU_COUNT=100 --env TEST_DURATION_SECS=60 dis/load-tests/baseline.js

# Stage 2 — Soak (~33min, detects memory leaks)
k6 run --env VU_COUNT=200 --env SOAK_MINUTES=30 dis/load-tests/soak.js

# Stage 3 — Spike (sudden burst, ~2.5min)
k6 run --env MAX_VUS=500 dis/load-tests/spike.js

# Stage 4 — Broadcast flood (all VUs one channel, ~3min)
k6 run --env VU_COUNT=300 dis/load-tests/broadcast_flood.js
```

---

## Documentation Index

| Document | What it covers |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Onboarding, day-to-day workflow, how to add features |
| [dis/README.md](dis/README.md) | Backend deep-dive: architecture, API & WS reference, DB schema |
| [discord-app/README.md](discord-app/README.md) | Frontend monorepo overview, shared-package wiring |
| [discord-app/discord-web/README.md](discord-app/discord-web/README.md) | Next.js web client |
| [discord-app/discord/README.md](discord-app/discord/README.md) | Expo / React Native mobile client |
| [discord-app/shared/types/README.md](discord-app/shared/types/README.md) | TypeScript interfaces (`@dis/types`) |
| [discord-app/shared/api/README.md](discord-app/shared/api/README.md) | REST client (`@dis/api`) |
| [discord-app/shared/ws/README.md](discord-app/shared/ws/README.md) | WebSocket client (`@dis/ws`) |
| [discord-app/shared/store/README.md](discord-app/shared/store/README.md) | Zustand state management (`@dis/store`) |
