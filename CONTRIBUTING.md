# Contributing — New Developer Onboarding

Everything you need to get productive on this project, from zero to running.

---

## Table of Contents

- [Project Map](#project-map)
- [Prerequisites](#prerequisites)
- [First-Time Setup](#first-time-setup)
- [Day-to-Day Development](#day-to-day-development)
- [Where to Find Things](#where-to-find-things)
- [How to Add a Feature](#how-to-add-a-feature)
- [Code Conventions](#code-conventions)
- [Debugging Tips](#debugging-tips)

---

## Project Map

```
chat/
├── dis/                    ← Rust backend (start here if touching APIs)
│   ├── src/
│   │   ├── handlers/      ← HTTP route handlers (thin — delegate to services)
│   │   ├── services/      ← Business logic (DB queries, validation)
│   │   ├── models/        ← Data types (DB rows, request/response structs)
│   │   ├── ws/            ← WebSocket subsystem (connection, manager, pub/sub)
│   │   ├── kafka/         ← Message queue (producer, consumer)
│   │   ├── middleware/     ← JWT auth extractor
│   │   └── ...
│   ├── migrations/         ← SQL schema (auto-run on startup)
│   └── load-tests/         ← k6 performance tests
│
└── discord-app/            ← Frontend monorepo
    ├── shared/
    │   ├── types/          ← TypeScript interfaces (shared by everything)
    │   ├── api/            ← REST client (ApiClient class)
    │   ├── ws/             ← WebSocket client (WsClient class)
    │   └── store/          ← Zustand global state (useDisStore)
    ├── discord-web/        ← Next.js web app
    │   ├── app/            ← Pages (login, chat)
    │   └── components/     ← UI components
    └── discord/            ← Expo mobile app
        ├── app/            ← Screens (login, chat)
        └── components/     ← UI components
```

**Rule of thumb:**
- Changing an **API endpoint**? → `dis/src/handlers/` + `dis/src/services/` + `shared/api/`
- Changing a **WebSocket event**? → `dis/src/ws/` + `shared/types/` + `shared/ws/`
- Changing **UI only**? → `discord-web/components/` or `discord/components/`
- Changing **shared logic**? → `shared/` (applies to both apps automatically)

---

## Prerequisites

| Tool | Install | Verify |
|------|---------|--------|
| Node.js >= 18 | `nvm install 18` | `node -v` |
| npm >= 9 | Comes with Node.js | `npm -v` |
| Rust (stable) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` | `rustc --version` |
| Docker | [docker.com](https://docs.docker.com/get-docker/) | `docker --version` |
| PostgreSQL >= 14 | `sudo apt install postgresql` (or Homebrew on Mac) | `psql --version` |

---

## First-Time Setup

### 1. Clone and install

```bash
git clone <repo-url> chat
cd chat
```

### 2. Backend infrastructure

```bash
# Start PostgreSQL
sudo systemctl start postgresql

# Start Redis + Kafka
cd dis/
docker compose up -d

# Create the .env file
cp .env.example .env
# Edit .env — set at least:
#   DATABASE_URL=postgres://your_user:your_password@localhost/dis
#   JWT_SECRET=any-random-string-at-least-32-chars
```

### 3. Run the backend

```bash
cd dis/
cargo run
# → http://localhost:3000 (REST)
# → ws://localhost:3000/ws (WebSocket)
```

First run takes a few minutes to compile. Subsequent runs are fast (~2s).

### 4. Frontend dependencies

```bash
cd discord-app/
npm install
```

### 5. Run the web app

```bash
cd discord-app/
npm run dev:web
# → http://localhost:3001
```

### 6. (Optional) Run the mobile app

```bash
cd discord-app/
npm run dev:mobile
# Scan QR code with Expo Go, or press 'w' for web
```

---

## Day-to-Day Development

```bash
# Terminal 1: Backend
cd dis/ && cargo run

# Terminal 2: Web frontend
cd discord-app/ && npm run dev:web

# Terminal 3 (optional): Mobile
cd discord-app/ && npm run dev:mobile
```

The backend hot-reloads if you use `cargo watch`:
```bash
cargo install cargo-watch
cargo watch -x run
```

The frontend hot-reloads automatically (Next.js Turbopack / Expo Metro).

---

## Where to Find Things

### "I need to add a new REST endpoint"

1. Define the request/response structs in `dis/src/models/`
2. Write the business logic in `dis/src/services/`
3. Create (or extend) a handler in `dis/src/handlers/`
4. Register the route in `dis/src/routes/mod.rs`
5. Add the corresponding method to `discord-app/shared/api/src/index.ts`
6. Update `discord-app/shared/types/src/index.ts` if new types are needed

### "I need to add a new WebSocket event"

1. Add the variant to `ServerMessage` or `ClientMessage` in `dis/src/ws/protocol.rs`
2. Handle it in `dis/src/ws/connection.rs` (for client→server) or publish from the relevant service
3. Mirror the type in `discord-app/shared/types/src/index.ts`
4. Handle it in the `onMessage` callback where `WsClient` is instantiated (chat page)

### "I need to change the database schema"

1. Create a new migration: `touch dis/migrations/YYYYMMDDHHMMSS_description.sql`
2. Write the SQL (the backend runs migrations automatically on startup)
3. Update the matching Rust model in `dis/src/models/`
4. Update the service queries in `dis/src/services/`

### "I need to add a new UI component"

- **Web only** → `discord-app/discord-web/components/`
- **Mobile only** → `discord-app/discord/components/`
- **Shared logic** → `discord-app/shared/` (both apps import it)

### "I need to update global state"

1. Add the field + action to `DisStore` in `discord-app/shared/store/src/index.ts`
2. Use it in any component: `const foo = useDisStore(s => s.foo)`

---

## How to Add a Feature (End-to-End Example)

**Example: Add message reactions**

```
1. Database
   → New migration: CREATE TABLE reactions (message_id, user_id, emoji, ...)
   → New model: dis/src/models/reaction.rs

2. Backend service
   → dis/src/services/reaction_service.rs (add/remove/list reactions)

3. Backend handler
   → dis/src/handlers/reaction_handler.rs
   → Register routes in dis/src/routes/mod.rs

4. WebSocket event (optional, for real-time updates)
   → Add "reaction_added" to ServerMessage in dis/src/ws/protocol.rs
   → Publish from the reaction service

5. Shared types
   → Add Reaction interface to shared/types/src/index.ts
   → Add addReaction()/removeReaction() to shared/api/src/index.ts
   → Add reactions to store if needed

6. Frontend
   → discord-web/components/ReactionPicker.tsx
   → discord/components/ReactionPicker.tsx (or skip for web-only)
```

---

## Code Conventions

### Rust (backend)

- Handlers are thin — extract params, call service, return response
- Services contain all business logic and SQL queries
- Models are plain structs with `Serialize`/`Deserialize`
- All errors go through `AppError` (never return raw status codes)
- Tests: `cargo test` (unit tests in each module)

### TypeScript (frontend)

- Shared packages export from `src/index.ts` — single entry point
- Components are memoized (`memo()`) when they receive stable props
- State reads use Zustand selector functions to minimize re-renders
- No raw `fetch()` calls — everything goes through `@dis/api`
- No raw `WebSocket` — everything goes through `@dis/ws`

### File naming

| Context | Convention | Example |
|---------|-----------|---------|
| Rust modules | `snake_case` | `auth_service.rs` |
| React components | `PascalCase` | `ChannelList.tsx` |
| Shared packages | `kebab-case` dirs, `index.ts` entry | `shared/api/src/index.ts` |

---

## Debugging Tips

### Backend

```bash
# See all SQL queries:
RUST_LOG=sqlx=debug cargo run

# See everything:
RUST_LOG=debug cargo run

# Check if infrastructure is running:
docker compose ps          # Redis + Kafka status
sudo systemctl status postgresql
curl http://localhost:3000/health   # Backend health check
```

### Frontend

```bash
# Reset Next.js cache (stale shared code):
rm -rf discord-app/discord-web/.next

# Check workspace resolution:
cd discord-app/ && npm ls @dis/api

# Expo cache reset:
cd discord-app/discord/ && npx expo start --clear
```

### WebSocket

Open browser DevTools → Network → WS tab. You'll see all frames:
- Outgoing: `subscribe`, `send_message`, `ping`
- Incoming: `new_message`, `subscribed`, `pong`

---

## Documentation Index

Each part of the project has its own README. Start with the one relevant to your task:

| README | What it covers |
|--------|---------------|
| [`README.md`](README.md) | Project overview, architecture, how everything connects |
| [`dis/README.md`](dis/README.md) | Backend deep-dive: every file, API reference, DB schema |
| [`discord-app/README.md`](discord-app/README.md) | Frontend monorepo: shared packages, how apps are wired |
| [`discord-app/discord-web/README.md`](discord-app/discord-web/README.md) | Web app: structure, features, auth flow |
| [`discord-app/discord/README.md`](discord-app/discord/README.md) | Mobile app: structure, WS lifecycle, secure storage |
| [`discord-app/shared/types/README.md`](discord-app/shared/types/README.md) | All TypeScript interfaces |
| [`discord-app/shared/api/README.md`](discord-app/shared/api/README.md) | REST client: every method → endpoint mapping |
| [`discord-app/shared/ws/README.md`](discord-app/shared/ws/README.md) | WebSocket client: reconnect, heartbeat, subscriptions |
| [`discord-app/shared/store/README.md`](discord-app/shared/store/README.md) | Zustand store: state shape, actions, selectors |
