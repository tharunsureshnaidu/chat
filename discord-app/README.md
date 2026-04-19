# Discord App — Real-Time Chat Frontend

A production-grade real-time chat frontend (Discord-like) built as a monorepo.  
Connects to a Rust/Axum + PostgreSQL + Redis backend.

---

## What This Is

Two apps sharing one brain:

| App | Framework | Platform |
|-----|-----------|----------|
| `discord-web` | Next.js 16 + Tailwind CSS | Browser |
| `discord` | Expo / React Native | iOS, Android, Web |

All business logic (API calls, WebSocket, state) lives in `shared/` and is imported by both apps.  
Neither app contains any HTTP or WebSocket code — they just call functions.

---

## Folder Structure

```
discord-app/
│
├── package.json          ← Monorepo root (npm workspaces)
│
├── shared/               ← Shared logic — imported by BOTH apps
│   ├── types/            ← TypeScript interfaces (User, Channel, Message, WS events)
│   ├── api/              ← REST client (ApiClient class)
│   ├── ws/               ← WebSocket client (WsClient class)
│   └── store/            ← Zustand global state (useDisStore)
│
├── discord-web/          ← Next.js web app (UI only)
│   ├── app/
│   │   ├── login/page.tsx
│   │   ├── chat/page.tsx
│   │   └── page.tsx      ← redirects to /login
│   └── components/
│       ├── ChannelList.tsx
│       ├── ChatWindow.tsx   ← virtualised with @tanstack/react-virtual
│       └── MessageInput.tsx
│
└── discord/              ← React Native / Expo mobile app (UI only)
    ├── app/
    │   ├── login.tsx
    │   └── chat.tsx
    └── components/
        ├── ChannelList.tsx
        ├── ChatWindow.tsx   ← FlatList (natively virtualised)
        └── MessageInput.tsx
```

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥ 18 | JavaScript runtime |
| npm | ≥ 9 | Package manager (workspaces) |
| Rust + Cargo | stable | Backend |
| PostgreSQL | ≥ 14 | Message persistence |
| Redis | ≥ 6 | Pub/Sub + Presence |

The backend lives at `../dis/` (sibling folder, not inside this repo).

---

## Running the Backend

The backend needs **PostgreSQL**, **Redis**, and **Kafka** running before it starts.  
Redis and Kafka run via Docker Compose. PostgreSQL runs via systemctl.  
If any of them is not running, `cargo run` will panic immediately.

### 1. Start PostgreSQL

```bash
sudo systemctl start postgresql
sudo systemctl status postgresql   # should say "active (running)"
```

### 2. Start Redis + Kafka (Docker)

Both Redis and Kafka run in Docker — no installation needed.

```bash
cd /home/tripfcatory/mine/projects/dis

docker compose up -d

# Verify everything is healthy:
docker compose ps       # STATUS should be "healthy" for both services
docker compose logs -f  # watch startup logs
```

- Redis listens on `localhost:6379`
- Kafka listens on `localhost:9092`
- The `chat_messages` topic is created automatically on first publish

Stop services:
```bash
docker compose down        # stop (data preserved in named volumes)
docker compose down -v     # stop + wipe all data
```

**Why Redis?**  
The backend uses Redis for two things:
- **Pub/Sub** — when the Kafka consumer processes a message, it publishes to `chat:channel:{id}`.  
  Every server instance subscribed to that channel receives it and forwards to  
  connected WebSocket clients. This is what makes multi-server messaging work.
- **Presence** — online/offline status is stored in Redis with a TTL (expiry).  
  No database load for presence checks.

Without Redis running you get:  
`Failed to connect to Redis: Connection refused (os error 111)`

### 4. Start the backend

```bash
cd /home/tripfcatory/mine/projects/dis

# Copy env file and fill in values (first time only)
cp .env.example .env
# Required variables:
#   DATABASE_URL=postgres://user:password@localhost/dis
#   REDIS_URL=redis://127.0.0.1:6379
#   JWT_SECRET=any-long-random-string
#   KAFKA_BROKERS=localhost:9092   (default, already set in .env.example)

cargo run
# Starts on http://localhost:3000
# WebSocket at ws://localhost:3000/ws
```

You should see:
```
INFO dis: Database connected and migrations applied
INFO dis: Redis connected
INFO dis: Kafka producer connected (brokers=localhost:9092)
INFO dis: Server running on 0.0.0.0:3000
```

If it panics, the most common causes are:
| Error | Fix |
|-------|-----|
| `Connection refused (os error 111)` on Redis | `docker compose up -d` in `dis/` |
| `Connection refused` on PostgreSQL | `sudo systemctl start postgresql` |
| `authentication failed` | Check `DATABASE_URL` in `.env` |
| Kafka broker unreachable | `docker compose up -d` in `dis/` |
| `invalid key` JWT error | Set `JWT_SECRET` in `.env` |

---

## Running the Frontend

### Step 1 — Install all dependencies (run once from the monorepo root)

```bash
cd /home/tripfcatory/mine/projects/discord-app
npm install
```

This installs deps for all workspaces and symlinks `@dis/types`, `@dis/api`,  
`@dis/ws`, `@dis/store` into each app's `node_modules/`.

---

### Step 2 — Configure environment

**Web app** — `discord-web/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3000/ws
```

**Mobile app** — `discord/.env`:
```
EXPO_PUBLIC_API_URL=http://192.168.x.x:3000
EXPO_PUBLIC_WS_URL=ws://192.168.x.x:3000/ws
```

> On mobile, replace `localhost` with your machine's local IP address.  
> Your phone cannot reach `localhost` — it needs the actual LAN IP.  
> Find it with: `ip addr show` (Linux) or `ipconfig` (Windows).

---

### Step 3 — Run the web app

```bash
cd /home/tripfcatory/mine/projects/discord-app/discord-web
npm run dev

# Opens at http://localhost:3001
# (3000 is taken by the Rust backend)
```

Navigate to `http://localhost:3001` — it redirects to `/login` automatically.

---

### Step 4 — Run the mobile app (optional)

```bash
cd /home/tripfcatory/mine/projects/discord-app/discord
npx expo start

# Press 'a' → Android emulator
# Press 'i' → iOS simulator  
# Press 'w' → Web browser
# Scan QR code → Expo Go on your phone
```

---

## Shortcut — Run from root

```bash
# Web
cd /home/tripfcatory/mine/projects/discord-app
npm run dev:web

# Mobile (separate terminal)
npm run dev:mobile
```

---

## Real-Time Flow (What Happens When You Send a Message)

```
User types "hello" → presses Enter
         │
         ▼
MessageInput.onSend("hello")
         │
         ▼
WsClient.sendMessage(channelId, "hello")
         │   sends → { type: "send_message", channel_id: "...", content: "hello" }
         ▼
Rust Server
  ├── saves to PostgreSQL
  └── publishes to Redis → chat:channel:{id}
         │
         ▼
Redis Pub/Sub broadcasts to ALL servers
         │
         ▼
WsClient.onmessage fires on ALL subscribers (including sender)
         │   receives ← { type: "new_message", id: "uuid", username: "...", content: "hello" }
         ▼
useDisStore.addMessage(channelId, message)
         │   deduplicates by id
         ▼
ChatWindow re-renders → message appears
```

---

## Architecture Decisions

### Why a monorepo with `shared/`?

Without shared packages, you write the same API and WebSocket logic in two places.  
A bug fix in one doesn't fix the other. With `shared/`, every fix applies to both apps instantly.

```
Without shared:
  discord-web/api.ts    ← login(), fetchChannels()
  discord/api.ts        ← login(), fetchChannels()  ← DUPLICATE — bugs diverge

With shared:
  shared/api/           ← login(), fetchChannels()  ← one source of truth
```

### Why Zustand over Redux / Context?

- Zero boilerplate — no actions, reducers, or providers
- Selector-based subscriptions — a component only re-renders when its slice of state changes
- Works identically in React (web) and React Native (mobile) — same import, same API

### Why no optimistic updates?

The Rust backend broadcasts every sent message back to the sender via Redis Pub/Sub.  
The round-trip is typically < 100ms on a local network.  
Optimistic updates added a "sending…" / duplicate message bug with no perceptible UX benefit.  
The WS echo is used as the single source of truth for all messages.

### Why virtualised lists?

Chat windows can have thousands of messages. Rendering all of them in the DOM  
causes severe memory and paint performance issues. Virtualisation renders only  
the messages currently visible on screen.

- Web: `@tanstack/react-virtual` (handles the math, we handle the DOM)
- Mobile: `FlatList` (React Native's built-in virtualised list)

### Why is the WebSocket token in the URL?

```
ws://localhost:3000/ws?token=eyJ...
```

Browsers do not allow custom headers on WebSocket connections.  
The JWT goes in the query string instead. The Rust server validates it  
before completing the upgrade handshake — invalid tokens get a 401 HTTP response.

### Why exponential back-off with jitter on reconnect?

```
Attempt 1 → wait  1s  × (0.75–1.25 random)
Attempt 2 → wait  2s  × jitter
Attempt 3 → wait  4s  × jitter
...capped at 30s
```

If 1000 users disconnect at once (server restart), they would all reconnect at  
exactly the same second without jitter — a thundering herd that spikes server load.  
Jitter spreads the reconnections over time.

---

## WebSocket Protocol Reference

### Client → Server

```json
{ "type": "subscribe",   "channel_id": "uuid" }
{ "type": "unsubscribe", "channel_id": "uuid" }
{ "type": "send_message","channel_id": "uuid", "content": "hello" }
{ "type": "ping" }
```

### Server → Client

```json
{ "type": "new_message", "id": "uuid", "channel_id": "uuid", "user_id": "uuid",
  "username": "string",  "content": "string", "timestamp": "RFC3339" }
{ "type": "subscribed",   "channel_id": "uuid" }
{ "type": "unsubscribed", "channel_id": "uuid" }
{ "type": "pong" }
{ "type": "error", "message": "string" }
```

---

## REST API Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Register new user |
| POST | `/api/auth/login` | No | Login, returns JWT |
| GET | `/api/channels` | Bearer | List all channels |
| POST | `/api/channels` | Bearer | Create a channel |
| GET | `/api/channels/:id/messages` | Bearer | Fetch message history |
| POST | `/api/channels/:id/messages` | Bearer | Send via REST (fallback) |
| GET | `/api/presence/:user_id` | Bearer | Online/offline status |

---

## Shared Package Reference

### `@dis/types`
Pure TypeScript interfaces. No runtime code. Imported by everything.

### `@dis/api` — `ApiClient`
```typescript
const api = new ApiClient('http://localhost:3000');
api.setToken(jwt);                           // call after login
await api.login(email, password);            // returns { token, user }
await api.fetchChannels();                   // returns Channel[]
await api.fetchMessages(channelId, limit);   // returns Message[]
```

### `@dis/ws` — `WsClient`
```typescript
const ws = new WsClient({ wsUrl, token, onMessage, onStatus });
ws.connect();                    // opens connection, auto-reconnects
ws.subscribe(channelId);         // sends subscribe event + stores for reconnect
ws.sendMessage(channelId, text); // sends send_message event
ws.destroy();                    // closes permanently, no reconnect
```

### `@dis/store` — `useDisStore`
```typescript
// In any React component:
const messages  = useDisStore(s => s.messages[channelId] ?? []);
const channels  = useDisStore(s => s.channels);
const wsStatus  = useDisStore(s => s.wsStatus);
const setActive = useDisStore(s => s.setActiveChannel);
```

---

## Token Storage

| Platform | Storage | Why |
|----------|---------|-----|
| Web | `localStorage` | Simple, survives page refresh |
| Mobile | `expo-secure-store` | Encrypted on-device storage |

---

## Common Issues

**Port 3000 in use** — The Rust backend runs on 3000. Next.js will automatically use 3001.

**Mobile can't connect** — Use your machine's LAN IP in `.env`, not `localhost`.

**`@dis/store` not found** — Run `npm install` from `discord-app/`, not from inside an app subfolder.

**Messages not appearing in other window** — Both windows must be on the same channel. WebSocket subscriptions are per-channel.

**Stale packages after editing `shared/`** — Delete `.next` and restart:
```bash
rm -rf discord-web/.next && npm run dev:web
```
