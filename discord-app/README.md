# discord-app — Frontend Monorepo

An npm workspaces monorepo containing two frontend apps and four shared packages for a real-time chat platform. Both apps connect to the same Rust/Axum backend and share all business logic.

---

## Apps

| Directory | Framework | Platform | Port |
|-----------|-----------|----------|------|
| `discord-web/` | Next.js 16 + Tailwind CSS v4 | Browser | 3001 |
| `discord/` | Expo SDK 54 + React Native | iOS, Android, Web | 8081 (Metro) |

## Shared Packages

All business logic lives in `shared/` — neither app contains any HTTP, WebSocket, or state management code.

| Package | Path | What It Does |
|---------|------|-------------|
| `@dis/types` | `shared/types/` | TypeScript interfaces: `User`, `Channel`, `Message`, `ServerMessage`, `ClientMessage`, etc. Pure types, no runtime code. |
| `@dis/api` | `shared/api/` | `ApiClient` class — wraps `fetch` for all REST endpoints. Injects `Authorization: Bearer` header automatically. |
| `@dis/ws` | `shared/ws/` | `WsClient` class — WebSocket with auto-reconnect (exponential back-off + jitter), heartbeat pings, channel subscription tracking. |
| `@dis/store` | `shared/store/` | Zustand store (`useDisStore`) — auth, channels, DMs, messages (per-channel map with dedup), friends, invites, unread counts, WS status. |

### Why Shared Packages?

Without `shared/`, the same API and WebSocket logic would be duplicated in both apps. A bug fix in one wouldn't fix the other. With `shared/`, every fix applies to both apps instantly:

```
Without shared:                          With shared:
  discord-web/api.ts  ← duplicated        shared/api/  ← one source of truth
  discord/api.ts      ← diverges          ↑ imported by both apps
```

---

## Folder Structure

```
discord-app/
├── package.json              ← Workspaces root
│
├── shared/
│   ├── types/src/index.ts    ← All TypeScript interfaces
│   ├── api/src/index.ts      ← ApiClient (REST)
│   ├── ws/src/index.ts       ← WsClient (WebSocket)
│   └── store/src/index.ts    ← Zustand global store
│
├── discord-web/              ← Next.js web app
│   ├── app/
│   │   ├── page.tsx          ← Redirects to /login
│   │   ├── login/page.tsx    ← Login + Register
│   │   └── chat/page.tsx     ← Main chat UI
│   └── components/
│       ├── ChannelList.tsx
│       ├── ChatWindow.tsx    ← Virtualised (@tanstack/react-virtual)
│       ├── MessageInput.tsx
│       ├── DiscoverModal.tsx ← Browse channels, invites, user search
│       └── CreateChannelModal.tsx
│
└── discord/                  ← Expo / React Native app
    ├── app/
    │   ├── _layout.tsx       ← Dark theme, Stack navigator
    │   ├── login.tsx         ← Login + Register
    │   └── chat.tsx          ← Main chat UI
    └── components/
        ├── ChannelList.tsx
        ├── ChatWindow.tsx    ← FlatList (natively virtualised)
        └── MessageInput.tsx
```

---

## How It Connects to the Backend

The Rust backend (`../dis/`) runs on `localhost:3000`. Both apps connect to it via two protocols:

```
                    ┌──────────────────────────────┐
                    │     Rust Backend (:3000)      │
                    │   Axum + PostgreSQL + Redis   │
                    │         + Kafka               │
                    └──────┬──────────────┬─────────┘
                           │              │
                    REST API         WebSocket
                  (HTTP JSON)     (ws://...?token=jwt)
                           │              │
              ┌────────────┴──────────────┴────────────┐
              │         @dis/api          @dis/ws       │
              │        (ApiClient)       (WsClient)     │
              │              shared/                     │
              └──────┬──────────────────────┬───────────┘
                     │                      │
              discord-web/             discord/
             (Next.js :3001)          (Expo :8081)
```

### REST API (`@dis/api`)
- Auth: `POST /api/auth/login`, `POST /api/auth/register`
- Channels: CRUD, members, discover, join, invites
- Messages: fetch (cursor-paginated), send
- Social: friends, friend requests
- Presence: online/offline status
- All authenticated endpoints use `Authorization: Bearer <jwt>`

### WebSocket (`@dis/ws`)
- Connects to `ws://host:3000/ws?token=<jwt>` (token in URL because browsers don't allow custom WS headers)
- Subscribes to channels → receives `new_message` events in real-time
- Also receives social notifications: friend requests, invites, join approvals
- Auto-reconnects with exponential back-off (1s → 30s) + jitter to prevent thundering herd

---

## Quick Start

### 1. Install dependencies (from this directory)

```bash
npm install
```

This installs all workspace dependencies and symlinks `@dis/*` packages.

### 2. Configure environment

**Web** — `discord-web/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3000/ws
```

**Mobile** — `discord/.env`:
```
EXPO_PUBLIC_API_URL=http://192.168.x.x:3000
EXPO_PUBLIC_WS_URL=ws://192.168.x.x:3000/ws
```
> Replace `192.168.x.x` with your machine's LAN IP for mobile devices.

### 3. Start the backend

See `../dis/README.md` or the root `README.md` for backend startup.

### 4. Run

```bash
# Web (opens at http://localhost:3001):
npm run dev:web

# Mobile (separate terminal):
npm run dev:mobile
```

---

## Token Storage

| Platform | Storage | Why |
|----------|---------|-----|
| Web | `localStorage` | Simple, survives page refresh |
| Mobile | `expo-secure-store` | Encrypted on-device storage |

---

## Web vs. Mobile Feature Comparison

| Feature | Web | Mobile |
|---------|-----|--------|
| Message virtualisation | `@tanstack/react-virtual` | `FlatList` (native) |
| Discover / browse channels | Full modal with search | Basic |
| Friend requests UI | Inline in discover modal | Basic |
| Create channel | Modal with description + public/private | Basic |
| Unread badges | Per-channel optimised subscriptions | Basic |
| WS on background | Stays connected | Disconnects (saves battery) |
| Styling | Tailwind CSS v4 | React Native StyleSheet |

Both apps share identical `@dis/api`, `@dis/ws`, `@dis/store`, and `@dis/types` — any change in `shared/` applies to both immediately.

---

## Common Issues

| Problem | Fix |
|---------|-----|
| `@dis/store` not found | Run `npm install` from `discord-app/`, not from inside an app |
| Mobile can't connect | Use LAN IP in `.env`, not `localhost` |
| Port 3000 in use | Backend uses 3000; Next.js auto-picks 3001 |
| Stale shared code after edit | Delete `.next/` and restart: `rm -rf discord-web/.next` |
| Messages not appearing | Both windows must be on the same channel |
