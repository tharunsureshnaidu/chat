# discord-web — Next.js Web Client

The browser-based frontend for the real-time chat app. Built with **Next.js 16**, **React 19**, **Tailwind CSS v4**, and **Zustand**. Connects to the Rust backend via the shared `@dis/*` packages — contains zero HTTP or WebSocket code itself.

> **Note:** This project uses **Next.js 16** which has breaking API changes compared to earlier versions. See `AGENTS.md` for AI tooling guidance.

---

## How It Fits Into the Monorepo

```
discord-app/          ← npm workspaces root
├── shared/           ← @dis/types, @dis/api, @dis/ws, @dis/store
├── discord-web/      ← THIS APP (Next.js, browser)
└── discord/          ← Expo / React Native (mobile)
```

This app imports everything from `shared/`:
- **`@dis/api`** — REST client (`ApiClient`) for login, channels, messages, social features
- **`@dis/ws`** — WebSocket client (`WsClient`) with auto-reconnect and heartbeat
- **`@dis/store`** — Zustand store (`useDisStore`) for all global state
- **`@dis/types`** — TypeScript interfaces shared with the mobile app

Turbopack is configured to watch the `shared/` directory via `turbopack.root` in `next.config.ts`, so edits to shared packages trigger hot reload.

---

## Project Structure

```
discord-web/
├── app/
│   ├── layout.tsx          ← Root layout (Geist font, dark background)
│   ├── page.tsx            ← Redirects to /login
│   ├── login/page.tsx      ← Login + Register form
│   └── chat/page.tsx       ← Main chat UI (orchestrates everything)
│
├── components/
│   ├── ChannelList.tsx     ← Sidebar: channels, DMs, user bar, logout
│   ├── ChatWindow.tsx      ← Virtualised message list (@tanstack/react-virtual)
│   ├── MessageInput.tsx    ← Text input with join-if-not-member flow
│   ├── DiscoverModal.tsx   ← Browse channels, manage invites/requests, search users
│   └── CreateChannelModal.tsx ← Create new channel form
│
├── next.config.ts          ← transpilePackages for @dis/*, turbopack root
├── postcss.config.mjs      ← PostCSS for Tailwind v4
├── tsconfig.json
└── package.json
```

---

## Key Features

| Feature | Implementation |
|---------|---------------|
| **Virtualised chat** | `@tanstack/react-virtual` — only visible messages are in the DOM |
| **Optimised re-renders** | Each `ChannelItem` subscribes to its own Zustand slice (unread count + active state) |
| **Discover modal** | 3 tabs: browse public channels, manage incoming requests/invites, search users |
| **Join flow** | Non-members see a "Join" button in the message input area |
| **DM support** | Friends list with DM channels, shown separately from group channels |
| **Unread badges** | Per-channel unread counts, social notification badge |
| **Real-time notifications** | Friend requests, channel invites, join approvals — all via WebSocket |
| **Auto-reconnect** | WsClient reconnects with exponential back-off + jitter on disconnect |

---

## Auth Flow

1. `/` → server-side redirect to `/login`
2. User submits email + password (or registers with username)
3. `ApiClient` calls `POST /api/auth/login` (or `/register`) on the Rust backend
4. On success: JWT + user object stored in `localStorage` AND Zustand store
5. Redirect to `/chat`
6. On `/chat` load: restores auth from `localStorage` if Zustand is empty (page refresh)

---

## Environment Variables

Create `.env.local` in this directory:

```
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3000/ws
```

Both default to `localhost:3000` if not set (the Rust backend's default port). Next.js auto-picks port 3001 since 3000 is taken.

---

## Running

```bash
# From this directory:
npm run dev

# Or from the monorepo root:
cd ../
npm run dev:web
```

Opens at **http://localhost:3001**.

> Make sure dependencies are installed first: run `npm install` from the monorepo root (`discord-app/`), not from this directory.

---

## How It Connects to the Backend

```
Browser
  │
  ├── REST API ──→ http://localhost:3000/api/*    (via @dis/api ApiClient)
  │                Authorization: Bearer <jwt>
  │
  └── WebSocket ──→ ws://localhost:3000/ws?token=<jwt>  (via @dis/ws WsClient)
                    Subscribes to channels, receives new_message events
```

The backend must be running for anything to work. See the root README for backend startup instructions.
