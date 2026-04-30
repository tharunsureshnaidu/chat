# dis — Real-Time Chat Backend

A production-grade, real-time chat backend built in **Rust** with **Axum**, **PostgreSQL**, **Redis**, and **Kafka**. Inspired by Discord — supports channels (public/private), direct messages, friend requests, channel invites, presence tracking, and WebSocket-based real-time messaging.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [How the Message Pipeline Works](#how-the-message-pipeline-works)
- [Infrastructure (Why Each Service Exists)](#infrastructure-why-each-service-exists)
- [Project Structure — Every File Explained](#project-structure--every-file-explained)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [WebSocket Protocol](#websocket-protocol)
- [Authentication & Security](#authentication--security)
- [Configuration (Environment Variables)](#configuration-environment-variables)
- [Running Locally](#running-locally)
- [Docker Deployment](#docker-deployment)
- [Load Testing](#load-testing)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                          Clients                                 │
│               (Web / Mobile / CLI via REST + WS)                 │
└────────────┬─────────────────────────────────┬───────────────────┘
             │  REST (HTTP)                    │  WebSocket
             ▼                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Axum Server                              │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐   │
│  │ Handlers│  │Middleware │  │ Services │  │  WS Connection │   │
│  │ (REST)  │  │  (Auth)  │  │(Business)│  │    Manager     │   │
│  └────┬────┘  └────┬─────┘  └────┬─────┘  └───────┬────────┘   │
│       │            │             │                 │             │
│       ▼            ▼             ▼                 ▼             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    AppState (shared)                      │   │
│  │  • PgPool  • Redis Pool  • WsManager  • KafkaProducer    │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────┬────────────────┬────────────────┬────────────────────────┘
       │                │                │
       ▼                ▼                ▼
  ┌──────────┐   ┌───────────┐   ┌───────────────┐
  │PostgreSQL│   │   Redis   │   │     Kafka     │
  │  (Data)  │   │(PubSub + │   │  (Message     │
  │          │   │ Presence +│   │   Queue)      │
  │          │   │  Dedup)   │   │               │
  └──────────┘   └───────────┘   └───────────────┘
```

**Three infrastructure services, each with a clear role:**

| Service      | Why it exists                                                                 |
|-------------|-------------------------------------------------------------------------------|
| **PostgreSQL** | Durable storage for users, channels, messages, friendships, memberships     |
| **Redis**      | In-memory: cross-instance pub/sub fanout, presence TTL keys, message dedup |
| **Kafka**      | Durable, ordered message queue decoupling send from persist+broadcast      |

---

## How the Message Pipeline Works

This is the core flow — understanding this is understanding the backend:

```
 Client A (WebSocket)
    │
    │  { "type": "send_message", "channel_id": "...", "content": "hello" }
    ▼
 ┌─────────────────────────────┐
 │  ws/connection.rs           │  1. Validates membership (fast-path: in-memory
 │  process_message()          │     subscription check; slow-path: DB query)
 │                             │  2. Builds a KafkaEnvelope (UUID, timestamp)
 │                             │  3. Publishes to Kafka topic "chat_messages"
 └────────────┬────────────────┘     (partitioned by channel_id for ordering)
              │
              ▼
 ┌─────────────────────────────┐
 │  Kafka Topic                │  Messages are durably stored in Kafka.
 │  "chat_messages"            │  Two independent consumer groups read them:
 │  (12 partitions)            │
 └────────┬───────────┬────────┘
          │           │
          ▼           ▼
 ┌────────────┐  ┌──────────────────┐
 │ Consumer 1 │  │   Consumer 2     │
 │ Persistence│  │  Notifications   │
 │ (kafka/    │  │  (notification/  │
 │ consumer.rs│  │   service.rs)    │
 └─────┬──────┘  └────────┬─────────┘
       │                  │
       │  1. Redis dedup  │  Checks presence —
       │     (SET NX EX)  │  if recipient offline,
       │  2. INSERT into  │  would fire push
       │     PostgreSQL   │  notification (TODO:
       │  3. Publish to   │  FCM/APNs hook)
       │     Redis PubSub │
       ▼                  │
 ┌─────────────────┐      │
 │ Redis PubSub    │      │
 │ "chat:channel:  │      │
 │  {channel_id}"  │      │
 └───────┬─────────┘      │
         │                │
         ▼                │
 ┌─────────────────────┐  │
 │ ws/redis_pubsub.rs  │  │
 │ run_subscriber()    │  │
 │                     │  │
 │ Pattern sub on      │  │
 │ "chat:channel:*"    │  │
 │ → manager.broadcast │  │
 └────────┬────────────┘  │
          │
          ▼
 ┌──────────────────────┐
 │  ws/manager.rs       │
 │  broadcast()         │
 │                      │
 │  For each subscribed │
 │  user → send via     │
 │  mpsc channel to     │
 │  their WebSocket     │
 └────────┬─────────────┘
          │
          ▼
    Client A, B, C ...
    (all subscribers of that channel
     receive the message via WebSocket)
```

### Why this design?

1. **Kafka decouples send from persist** — the WebSocket handler returns instantly after publishing; the client doesn't wait for the DB write. If the DB is slow, messages are buffered in Kafka.

2. **Kafka guarantees ordering** — messages are partitioned by `channel_id`, so messages in the same channel are always processed in order.

3. **Redis Pub/Sub enables multi-server fanout** — if you run 5 backend instances, each subscribes to `chat:channel:*`. A message persisted by instance #2's consumer gets published to Redis and received by ALL instances, which then forward it to their locally connected clients.

4. **Redis dedup prevents duplicates** — Kafka has at-least-once delivery. The `SET NX EX` dedup key ensures that even if a message is delivered twice (e.g., consumer crash before commit), only one instance processes it.

---

## Infrastructure (Why Each Service Exists)

### PostgreSQL

**Role:** Durable, relational storage.

- Stores all persistent data: users, channels, messages, memberships, friendships, invites, join requests
- Connection pooling via **sqlx** (`PgPool`) with configurable pool size
- Migrations run automatically on startup (`sqlx::migrate!`)
- Uses `gen_random_uuid()` for primary keys (built into PostgreSQL 13+)
- GIN trigram indexes (`pg_trgm`) for fast `ILIKE '%query%'` searches on channel names and usernames

**Configured in:** `src/db/mod.rs` (pool creation), `src/config/mod.rs` (`DATABASE_URL`, pool sizes)

### Redis

**Role:** Fast in-memory operations — three distinct uses:

1. **Pub/Sub fanout** (`src/ws/redis_pubsub.rs`):
   - After a message is persisted, it's published to a Redis channel `chat:channel:{channel_id}`
   - Every server instance subscribes to `chat:channel:*` with a pattern subscription
   - This is how messages reach WebSocket clients connected to different server instances

2. **Presence tracking** (`src/presence/service.rs`):
   - Each online user has a key `presence:user:{user_id}` with a TTL (default 60s)
   - A heartbeat task refreshes the TTL every 30s while the WebSocket is open
   - On disconnect, the key is deleted immediately
   - Any service can check if a user is online with a simple `EXISTS` command

3. **Message deduplication** (`src/delivery/dedup.rs`):
   - Kafka provides at-least-once delivery — a message could be delivered more than once
   - Before processing, the consumer runs `SET dedup:msg:{message_id} 1 NX EX 86400`
   - If the key already exists, another consumer already handled it → skip
   - Eliminates the TOCTOU race that a `GET → SET` pattern would have

**Configured in:** `src/ws/redis_pubsub.rs` (pool factory), `src/config/mod.rs` (`REDIS_URL`, pool size)

### Kafka

**Role:** Durable, ordered message queue.

- Uses KRaft mode (no ZooKeeper) — single-broker setup in Docker
- 12 partitions on the `chat_messages` topic for parallel consumption
- Messages are keyed by `channel_id` → same channel's messages go to the same partition → **ordering within a channel is guaranteed**
- Two independent consumer groups read the same topic:
  - `dis-persistence` — writes to DB + publishes to Redis
  - `dis-notifications` — checks presence for push notification decisions
- Producer uses `acks=all` for durability, with retries on transient failures
- 7-day message retention in Kafka as a replay buffer

**Configured in:** `src/kafka/producer.rs`, `src/kafka/consumer.rs`, `src/config/mod.rs` (`KAFKA_BROKERS`, `KAFKA_TOPIC`, consumer groups)

---

## Project Structure — Every File Explained

```
dis/
├── Cargo.toml                  # Rust dependencies and project metadata
├── Dockerfile                  # Multi-stage build: rust:1.75 → debian:bookworm-slim
├── docker-compose.yml          # Redis + Kafka + backend orchestration
├── .env.example                # Template for all environment variables
├── .env                        # Actual env vars (gitignored)
│
├── migrations/                 # SQL migrations (run automatically on startup)
│   ├── 20240101000001_create_tables.sql      # Core: users, channels, messages
│   ├── 20240101000002_social_features.sql    # channel_members, join_requests, invites, friends
│   ├── 20240101000003_perf_indexes.sql       # GIN trigram indexes, friends reverse index
│   └── 20240101000004_users_search_index.sql # GIN trigram on users.username
│
├── load-tests/                 # k6 load testing scripts
│   ├── setup.js                # Test helpers (register, login, create channels)
│   ├── baseline.js             # Standard load profile
│   ├── broadcast_flood.js      # Stress test: flood messages to broadcast
│   ├── soak.js                 # Long-running endurance test
│   ├── spike.js                # Sudden traffic spike test
│   ├── tune.sh                 # Shell script to run tuning tests
│   └── watch.sh                # Monitor test execution
│
└── src/
    ├── main.rs                 # Entry point: boots everything, wires it together
    ├── errors.rs               # AppError enum + Axum IntoResponse impl
    ├── retry.rs                # Generic async retry with exponential backoff
    │
    ├── config/
    │   └── mod.rs              # Config struct — reads all env vars
    │
    ├── db/
    │   └── mod.rs              # PostgreSQL pool creation + migration runner
    │
    ├── routes/
    │   └── mod.rs              # All HTTP routes defined in one place
    │
    ├── middleware/
    │   ├── mod.rs              # Module declaration
    │   └── auth.rs             # AuthUser extractor (JWT Bearer validation)
    │
    ├── handlers/               # HTTP request handlers (thin — delegate to services)
    │   ├── mod.rs              # Module declarations
    │   ├── auth_handler.rs     # POST /api/auth/register, POST /api/auth/login
    │   ├── channel_handler.rs  # CRUD channels, list members, remove member
    │   ├── message_handler.rs  # POST message (→ Kafka), GET messages (from DB)
    │   ├── presence_handler.rs # GET /api/presence/:user_id
    │   └── social_handler.rs   # Join, invite, friend, discover, search
    │
    ├── services/               # Business logic (validation, DB queries, auth)
    │   ├── mod.rs              # Module declarations
    │   ├── auth_service.rs     # Register, login, JWT create/validate, Argon2
    │   ├── channel_service.rs  # Channel CRUD, membership checks, admin auth
    │   ├── message_service.rs  # Message persistence + cursor-based pagination
    │   └── social_service.rs   # All social features (join, invite, friend, etc.)
    │
    ├── models/                 # Data types (DB rows, request/response structs)
    │   ├── mod.rs              # Module declarations
    │   ├── user.rs             # User, UserPublic, RegisterRequest, LoginRequest
    │   ├── channel.rs          # Channel, ChannelSummary, CreateChannelRequest
    │   ├── message.rs          # Message, MessageWithAuthor, MessageQuery
    │   └── social.rs           # All social models (members, invites, friends)
    │
    ├── ws/                     # WebSocket subsystem
    │   ├── mod.rs              # Module declarations
    │   ├── handler.rs          # HTTP → WS upgrade handler (JWT validation)
    │   ├── connection.rs       # Per-connection lifecycle (recv/send loops)
    │   ├── manager.rs          # In-memory registry of all WS connections
    │   └── redis_pubsub.rs     # Redis pub/sub bridge + pool factory
    │
    ├── kafka/                  # Kafka subsystem
    │   ├── mod.rs              # Module declarations
    │   ├── producer.rs         # KafkaEnvelope + publish logic
    │   └── consumer.rs         # Persistence consumer (DB write + Redis fanout)
    │
    ├── delivery/               # Exactly-once delivery helpers
    │   ├── mod.rs              # Module declaration
    │   └── dedup.rs            # Redis SET NX EX dedup for Kafka messages
    │
    ├── presence/               # Online/offline presence tracking
    │   ├── mod.rs              # Module declaration
    │   └── service.rs          # set_online, refresh, set_offline, is_online
    │
    └── notification/           # Push notification subsystem
        ├── mod.rs              # Module declaration
        └── service.rs          # Kafka consumer that checks presence (FCM stub)
```

---

### File-by-File Deep Dive

#### `src/main.rs` — The Entry Point

This is where the entire application boots up. Here's what happens in order:

1. **Load `.env`** — `dotenvy::dotenv()` reads environment variables from `.env`
2. **Init logging** — `tracing_subscriber` with `RUST_LOG` env filter
3. **Read config** — `Config::from_env()` parses all env vars into a typed struct
4. **Connect PostgreSQL** — with retry logic (up to 10 attempts, exponential backoff)
5. **Run migrations** — `sqlx::migrate!` applies any pending SQL migrations
6. **Connect Redis** — builds a `deadpool_redis` connection pool, verifies with PING
7. **Create WsManager** — in-memory registry for WebSocket connections
8. **Spawn Redis subscriber** — background task that forwards pub/sub messages to WsManager
9. **Connect Kafka producer** — verifies broker reachability via metadata fetch
10. **Spawn Kafka persistence consumer** — background task that reads messages, persists to DB, publishes to Redis
11. **Spawn notification consumer** — background task for push notifications (separate consumer group)
12. **Build AppState** — struct holding all shared resources (pool, redis, ws_manager, kafka)
13. **Build Axum router** — all routes, middleware (CORS, tracing, body limit)
14. **Start server** — bind to address, serve with graceful shutdown (Ctrl+C / SIGTERM)

#### `src/config/mod.rs` — Configuration

A single `Config` struct that reads every environment variable the app needs. Provides sensible defaults for non-critical settings (Redis URL, pool sizes, presence intervals). Panics on startup if `DATABASE_URL` or `JWT_SECRET` are missing.

#### `src/db/mod.rs` — Database Pool

Creates the `sqlx::PgPool` with tuned settings:
- `acquire_timeout`: 5s (fail fast, don't block a request for 30s)
- `idle_timeout`: 10 minutes (close stale connections)
- `max_lifetime`: 30 minutes (force reconnect after Postgres restarts)

Also runs all SQL migrations from `./migrations/` on startup.

#### `src/errors.rs` — Error Handling

Defines `AppError` with variants: `Database`, `Auth`, `NotFound`, `Validation`, `Conflict`, `Internal`. Implements Axum's `IntoResponse` so errors automatically become JSON `{ "error": "..." }` with the right HTTP status code. Database errors are logged but never exposed to the client (returns generic "Internal server error").

#### `src/retry.rs` — Retry Helper

Generic async retry function used during startup to wait for infrastructure services (Postgres, Redis, Kafka) to become available. Tries up to 10 times with exponential backoff (1s → 2s → 4s … capped at 30s). Panics if all attempts fail.

#### `src/routes/mod.rs` — Route Definitions

All HTTP routes in one file. Maps URL patterns to handler functions. Also contains the `/health` endpoint which checks both PostgreSQL and Redis connectivity, returning `200 OK` or `503 Service Unavailable` with a JSON status object.

#### `src/middleware/auth.rs` — JWT Auth Extractor

Implements `AuthUser` as an Axum `FromRequestParts` extractor. Any handler that takes `auth: AuthUser` is automatically protected:
1. Extracts the `Authorization: Bearer <token>` header
2. Validates the JWT (HS256 only — prevents algorithm confusion attacks)
3. Parses the `user_id` (UUID) and `username` from claims
4. Returns `401 Unauthorized` if anything is invalid

#### `src/handlers/` — HTTP Handlers (Thin Layer)

Handlers extract request data (path params, query params, JSON body, auth), delegate to the appropriate service function, and return a response. They contain no business logic themselves.

| File | Endpoints | What it does |
|------|-----------|-------------|
| `auth_handler.rs` | `POST /api/auth/register`, `POST /api/auth/login` | Registration + login |
| `channel_handler.rs` | `POST/GET /api/channels`, `GET/PUT/DELETE /api/channels/:id`, members | Channel CRUD + membership |
| `message_handler.rs` | `POST /api/channels/:id/messages`, `GET /api/channels/:id/messages` | Send (→ Kafka) + fetch (from DB) |
| `presence_handler.rs` | `GET /api/presence/:user_id` | Check if a user is online |
| `social_handler.rs` | Join, invites, friends, discover, search | All social features |

#### `src/services/` — Business Logic

| File | Responsibilities |
|------|-----------------|
| `auth_service.rs` | Password hashing (Argon2), JWT generation/validation (HS256), user registration (input validation, uniqueness checks), login (constant-time password verification, anti-enumeration error messages) |
| `channel_service.rs` | Create channel (+ auto-admin), list my channels/DMs, get/update/delete channel (admin-only), `require_admin()` helper, `is_member()` check |
| `message_service.rs` | Direct DB message insert (unused in hot path — Kafka handles it), cursor-based message pagination (`before_id` for scroll-up, `after_id` for offline sync) |
| `social_service.rs` | **The largest file** — all social logic: discover channels, join (public = instant, private = request), approve/reject join requests, invite users, respond to invites, send/accept/reject friend requests. When a friend request is accepted, it atomically creates a DM channel + friendship + channel membership in a single transaction. Real-time notifications via `WsManager.send_to()`. |

#### `src/models/` — Data Types

| File | Types |
|------|-------|
| `user.rs` | `User` (DB row), `UserPublic` (no password hash), `RegisterRequest`, `LoginRequest`, `AuthResponse` |
| `channel.rs` | `Channel`, `ChannelSummary` (with member_count + my_role), `CreateChannelRequest`, `UpdateChannelRequest` |
| `message.rs` | `Message`, `MessageWithAuthor` (joined with username), `SendMessageRequest`, `MessageQuery` (cursor pagination params) |
| `social.rs` | `ChannelMember`, `ChannelMemberWithUser`, `JoinRequest`, `JoinRequestWithUser`, `ChannelInvite`, `ChannelInviteDetails`, `FriendRequest`, `FriendRequestWithUser`, `FriendWithUser`, `InviteUserRequest`, `SendFriendRequestBody` |

#### `src/ws/handler.rs` — WebSocket Upgrade

Handles the `GET /ws?token=<jwt>` endpoint. The JWT is passed as a query parameter (not a header) because the browser's `WebSocket` API doesn't support custom headers. Validates the token **before** the upgrade — invalid tokens get a `401 HTTP` response, not a dropped socket.

#### `src/ws/connection.rs` — Per-Connection Lifecycle

After the upgrade, each WebSocket connection runs two concurrent tasks:

- **send_task** — reads from an `mpsc::UnboundedReceiver` and forwards messages to the WebSocket sink. Messages arrive as `Arc<String>` (broadcast wraps once, clones cheaply).
- **recv_task** — reads client frames and dispatches via `process_message()`:
  - `subscribe { channel_id }` — checks channel visibility + membership, registers in WsManager
  - `unsubscribe { channel_id }` — removes from WsManager
  - `send_message { channel_id, content }` — validates membership (fast-path: check subscription; slow-path: DB), publishes to Kafka
  - `ping` → responds with `pong`

On disconnect (either task exits), the other is aborted, presence is cleared, and subscriptions are cleaned up.

#### `src/ws/manager.rs` — Connection Registry

Thread-safe (`DashMap`-based) registry of all active WebSocket connections on this server instance:

- `connections`: `user_id → mpsc::Sender` — to push messages to a specific user
- `channel_subs`: `channel_id → Set<user_id>` — who's subscribed to what
- `user_channels`: `user_id → Set<channel_id>` — reverse index for O(1) disconnect cleanup

Key methods:
- `connect()` / `disconnect()` — register/remove a client
- `subscribe()` / `unsubscribe()` — manage channel subscriptions
- `broadcast(channel_id, message, exclude)` — fan out to all subscribers, wraps in `Arc` once
- `send_to(user_id, message)` — direct message to one user (for notifications)

#### `src/ws/redis_pubsub.rs` — Redis Pub/Sub Bridge

Two responsibilities:

**Publishing** (`publish()`): After the Kafka consumer persists a message, it publishes to `chat:channel:{channel_id}`. Uses a pooled connection (true concurrent publish).

**Subscribing** (`run_subscriber()`): A single long-running task per server instance:
1. Opens a dedicated Redis connection (pub/sub connections can't do regular commands)
2. Pattern-subscribes to `chat:channel:*`
3. On each incoming message, deserializes and calls `manager.broadcast()`
4. Auto-reconnects on errors with a 2s backoff

Also contains the connection pool factory (`create_pool`, `create_and_verify_pool`) and a `ping()` function used by the health endpoint.

#### `src/kafka/producer.rs` — Kafka Producer

`KafkaProducer` wraps `rdkafka::FutureProducer`:
- `acks=all` — waits for all in-sync replicas
- Retries up to 3 times with 200ms backoff
- `create()` verifies broker reachability via metadata fetch (used with retry helper)
- `publish()` — serializes a `KafkaEnvelope` and publishes, keyed by `channel_id` (same channel → same partition → ordered)

`KafkaEnvelope` contains: `id` (UUID), `channel_id`, `user_id`, `username`, `content`, `timestamp` (RFC3339).

#### `src/kafka/consumer.rs` — Persistence Consumer

Runs forever in a background task. For each Kafka message:
1. **Dedup** — `SET NX EX` in Redis. If key exists → skip (another instance handled it)
2. **Persist** — `INSERT INTO messages ... ON CONFLICT DO NOTHING`. The ON CONFLICT is a secondary safety net if the Redis dedup key expired.
3. **Publish** — Sends to Redis Pub/Sub for real-time WebSocket fanout

Auto-reconnects on broker errors with 5s backoff.

#### `src/delivery/dedup.rs` — Message Deduplication

`MessageDedup.try_claim(pool, message_id)`:
- Executes `SET dedup:msg:{uuid} 1 NX EX 86400` (24h TTL)
- Returns `true` if this instance claimed the message (first to set)
- Returns `false` if already claimed (duplicate delivery)
- **Fails open** on Redis errors — processes the message rather than silently dropping it

This replaces the older `EXISTS → SETEX` pattern which had a TOCTOU race window.

#### `src/presence/service.rs` — Presence Tracking

Tracks online/offline status using Redis keys with TTL:

- `set_online(user_id, ttl)` — `SET EX` the presence key (called on WS connect)
- `refresh(user_id, ttl)` — `EXPIRE` the key (called by heartbeat timer)
- `set_offline(user_id)` — `DEL` the key (called on WS disconnect)
- `is_online(user_id)` — `EXISTS` check (used by presence endpoint + notification consumer)
- `spawn_heartbeat()` — spawns a Tokio task that calls `refresh()` every N seconds

The heartbeat pattern: as long as the WebSocket is alive, the heartbeat task prevents the TTL from expiring. If the server crashes without clean disconnect, the key naturally expires after `presence_ttl_secs` (default 60s).

#### `src/notification/service.rs` — Push Notification Consumer

A separate Kafka consumer group (`dis-notifications`) with independent offset tracking. For each message:
1. Checks if the sender is online (via Presence service)
2. If offline → would trigger FCM/APNs push (currently a TODO/debug log)

This runs independently from the persistence consumer — they process the same messages but serve different purposes.

---

## Database Schema

### Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `users` | User accounts | `id`, `username` (unique), `email` (unique), `password_hash` |
| `channels` | Chat channels (public, private, DM) | `id`, `name`, `is_public`, `is_direct`, `created_by` |
| `messages` | Chat messages | `id`, `channel_id` (FK), `user_id` (FK), `content` (1–4000 chars) |
| `channel_members` | Who belongs to which channel | `(channel_id, user_id)` PK, `role` (admin/member) |
| `join_requests` | Pending requests to join private channels | `channel_id`, `user_id`, `status` (pending/approved/rejected) |
| `channel_invites` | Admin invitations to join a channel | `channel_id`, `inviter_id`, `invitee_id`, `status` |
| `friend_requests` | Pending friend requests | `sender_id`, `receiver_id`, `status` |
| `friends` | Accepted friendships + shared DM channel | `user_id_1 < user_id_2` (enforced), `dm_channel_id` |

### Indexes

| Index | On | Purpose |
|-------|----|---------|
| `idx_messages_channel_created` | `messages(channel_id, created_at DESC)` | Fast "latest messages in channel" query |
| `idx_channel_members_user` | `channel_members(user_id)` | Fast "which channels am I in?" |
| `idx_join_requests_channel_pending` | `join_requests(channel_id) WHERE status='pending'` | Partial index for pending requests |
| `idx_channel_invites_invitee_pending` | `channel_invites(invitee_id) WHERE status='pending'` | Partial index for pending invites |
| `idx_friend_requests_receiver_pending` | `friend_requests(receiver_id) WHERE status='pending'` | Partial index for pending requests |
| `idx_channels_name_trgm` | `channels(name) GIN gin_trgm_ops` | Trigram index for `ILIKE '%query%'` search |
| `idx_users_username_trgm` | `users(username) GIN gin_trgm_ops` | Trigram index for user search |
| `idx_friends_user_id_2` | `friends(user_id_2)` | Reverse lookup (PK covers user_id_1) |

### Migrations

Run automatically on startup via `sqlx::migrate!`. Applied in order:

1. **`20240101000001`** — Core tables: `users`, `channels`, `messages`
2. **`20240101000002`** — Social features: extends channels (description, visibility, ownership, DM flag), adds `channel_members`, `join_requests`, `channel_invites`, `friend_requests`, `friends`
3. **`20240101000003`** — Performance: pg_trgm extension, GIN trigram index on channel names, reverse friends index
4. **`20240101000004`** — GIN trigram index on `users.username` for fast user search

---

## API Reference

All endpoints except auth require `Authorization: Bearer <jwt>` header.

### Auth

| Method | Path | Body | Response | Description |
|--------|------|------|----------|-------------|
| `POST` | `/api/auth/register` | `{ username, email, password }` | `201 { token, user }` | Create account |
| `POST` | `/api/auth/login` | `{ email, password }` | `200 { token, user }` | Get JWT |

### Channels

| Method | Path | Body/Query | Response | Description |
|--------|------|-----------|----------|-------------|
| `POST` | `/api/channels` | `{ name, description?, is_public? }` | `201 Channel` | Create (you become admin) |
| `GET` | `/api/channels` | — | `200 [ChannelSummary]` | List channels you belong to |
| `GET` | `/api/channels/dms` | — | `200 [ChannelSummary]` | List your DM channels |
| `GET` | `/api/channels/:id` | — | `200 Channel` | Get channel details |
| `PUT` | `/api/channels/:id` | `{ name?, description?, is_public? }` | `200 Channel` | Update (admin only) |
| `DELETE` | `/api/channels/:id` | — | `204` | Delete (admin only) |
| `GET` | `/api/channels/:id/members` | — | `200 [Member]` | List members (must be member) |
| `DELETE` | `/api/channels/:id/members/:uid` | — | `204` | Kick member (admin) or leave (self) |

### Messages

| Method | Path | Body/Query | Response | Description |
|--------|------|-----------|----------|-------------|
| `POST` | `/api/channels/:id/messages` | `{ content }` | `202` | Send via Kafka (async) |
| `GET` | `/api/channels/:id/messages` | `?limit=50&before_id=...&after_id=...` | `200 [Message]` | Cursor-based pagination |

### Social

| Method | Path | Body/Query | Description |
|--------|------|-----------|-------------|
| `POST` | `/api/channels/:id/join` | — | Join public channel / request for private |
| `GET` | `/api/channels/:id/join-requests` | — | List pending requests (admin) |
| `GET` | `/api/join-requests` | — | All pending requests for your admin channels |
| `POST` | `/api/join-requests/:id` | `{ approve: bool }` | Approve/reject (admin) |
| `POST` | `/api/channels/:id/invite` | `{ username }` | Invite user (admin) |
| `GET` | `/api/invites` | — | List your pending invites |
| `POST` | `/api/invites/:id` | `{ accept: bool }` | Accept/reject invite |
| `POST` | `/api/friends` | `{ username }` | Send friend request |
| `GET` | `/api/friends` | — | List your friends |
| `GET` | `/api/friend-requests` | — | List pending friend requests |
| `POST` | `/api/friend-requests/:id` | `{ accept: bool }` | Accept/reject |
| `GET` | `/api/discover/channels` | `?q=search` | Browse all channels |
| `GET` | `/api/discover/users` | `?q=search` | Search users by username |

### Presence & Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/presence/:user_id` | `{ user_id, online: bool }` |
| `GET` | `/health` | `{ status, db, redis }` — returns 503 if degraded |

---

## WebSocket Protocol

Connect: `ws://host:3000/ws?token=<jwt>`

### Client → Server

```json
{ "type": "subscribe", "channel_id": "uuid" }
{ "type": "unsubscribe", "channel_id": "uuid" }
{ "type": "send_message", "channel_id": "uuid", "content": "hello" }
{ "type": "ping" }
```

### Server → Client

```json
{ "type": "new_message", "id": "uuid", "channel_id": "uuid", "user_id": "uuid", "username": "alice", "content": "hello", "timestamp": "2024-01-01T00:00:00Z" }
{ "type": "subscribed", "channel_id": "uuid" }
{ "type": "unsubscribed", "channel_id": "uuid" }
{ "type": "pong" }
{ "type": "error", "message": "..." }
```

### Real-Time Notifications (push to specific users)

```json
{ "type": "friend_request_received", "sender_id": "uuid", "sender_username": "alice" }
{ "type": "friend_request_accepted", "friend_id": "uuid", "friend_username": "bob", "dm_channel_id": "uuid" }
{ "type": "channel_invite_received", "channel_id": "uuid", "channel_name": "general", "inviter_username": "alice" }
{ "type": "join_request_approved", "channel_id": "uuid" }
{ "type": "join_request_rejected", "channel_id": "uuid" }
```

---

## Authentication & Security

- **Password hashing**: Argon2 (memory-hard, OWASP recommended) via the `argon2` crate
- **JWT**: HS256 only — explicitly rejects all other algorithms to prevent `alg:none` attacks
- **Token validation**: Bearer scheme on REST, query param on WebSocket (browser WS API limitation)
- **Anti-enumeration**: Login returns the same error for wrong email and wrong password
- **Input validation**: Username (3–32 chars, alphanumeric + underscore), email (contains @, ≤254 chars), password (≥8 chars, not all digits, not blank)
- **CORS**: Configurable `ALLOWED_ORIGINS`; defaults to permissive for local dev
- **Body limit**: Configurable max request body size (default 512 KiB) to prevent DoS
- **DB errors hidden**: `AppError::Database` always returns "Internal server error" to the client
- **Log safety**: Request tracing logs only the path — query params (like `?token=`) are excluded
- **Graceful shutdown**: Handles Ctrl+C and SIGTERM, drains active connections

---

## Configuration (Environment Variables)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `JWT_SECRET` | **Yes** | — | Secret for signing JWTs |
| `REDIS_URL` | No | `redis://127.0.0.1:6379` | Redis connection URL |
| `REDIS_POOL_SIZE` | No | `20` | Max Redis connections per pool |
| `JWT_EXPIRY_HOURS` | No | `24` | JWT token lifetime |
| `SERVER_HOST` | No | `0.0.0.0` | Bind address |
| `SERVER_PORT` | No | `3000` | Bind port |
| `ALLOWED_ORIGINS` | No | (permissive) | Comma-separated CORS origins |
| `BODY_LIMIT_BYTES` | No | `524288` | Max HTTP body size (512 KiB) |
| `PRESENCE_HEARTBEAT_SECS` | No | `30` | Presence refresh interval |
| `PRESENCE_TTL_SECS` | No | `60` | Presence key TTL |
| `DB_POOL_MAX_CONNECTIONS` | No | `100` | Max PostgreSQL connections |
| `DB_POOL_MIN_CONNECTIONS` | No | `5` | Min warm connections |
| `KAFKA_BROKERS` | No | `localhost:9092` | Kafka broker list |
| `KAFKA_TOPIC` | No | `chat_messages` | Kafka topic name |
| `KAFKA_CONSUMER_GROUP` | No | `dis-persistence` | Persistence consumer group |
| `KAFKA_NOTIFICATION_GROUP` | No | `dis-notifications` | Notification consumer group |

---

## Running Locally

### Prerequisites

- Rust 1.75+ (for the backend)
- PostgreSQL 13+ (for `gen_random_uuid()`)
- Redis 7+
- Kafka (or use the Docker Compose setup)

### Quick Start

```bash
# 1. Start infrastructure
docker compose up -d redis kafka

# 2. Create a PostgreSQL database (if not using Docker for Postgres)
createdb dis

# 3. Copy and edit environment config
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL and JWT_SECRET

# 4. Build and run
cargo run
```

The server will:
- Retry connecting to Postgres, Redis, Kafka (up to 10 times each)
- Run all pending SQL migrations
- Start listening on `http://0.0.0.0:3000`

---

## Docker Deployment

```bash
# Build and start everything (Redis + Kafka + backend)
docker compose up --build

# The backend is exposed on port 3000
curl http://localhost:3000/health
```

### Docker Compose Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `redis` | `redis:7-alpine` | 6379 (internal) | Cache, pub/sub, presence, dedup |
| `kafka` | `confluentinc/cp-kafka:7.7.1` | 9092 (internal) | Message queue (KRaft, no ZooKeeper) |
| `backend` | Built from `Dockerfile` | **3000** (exposed) | The Rust application |

### Kafka Configuration

- KRaft mode (built-in consensus, no ZooKeeper dependency)
- 12 partitions by default (supports parallel consumers)
- Auto-creates topics on first use
- 7-day message retention
- `rebalance_delay = 0` for fast startup

### Redis Configuration

- Max 10,000 clients, 512 MB memory cap
- LRU eviction when full
- TCP keepalive enabled
- Persistence: RDB snapshots every 900s (1 change) or 300s (10 changes)

---

## Load Testing

Load tests use [k6](https://k6.io/) and are in the `load-tests/` directory:

```bash
# Install k6, then:
k6 run load-tests/baseline.js      # Standard load
k6 run load-tests/spike.js         # Sudden traffic spike
k6 run load-tests/soak.js          # Long-running endurance
k6 run load-tests/broadcast_flood.js  # Message broadcast stress

# Or use the helper scripts:
./load-tests/tune.sh   # Run tuning tests
./load-tests/watch.sh  # Monitor live
```
