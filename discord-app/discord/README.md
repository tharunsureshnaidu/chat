# discord — Expo / React Native Mobile Client

The mobile frontend for the real-time chat app. Built with **Expo SDK 54**, **React Native 0.81**, **Expo Router**, and **Zustand**. Runs on iOS, Android, and web. Shares all business logic with the Next.js web app via the `@dis/*` packages — contains zero HTTP or WebSocket code itself.

---

## How It Fits Into the Monorepo

```
discord-app/          ← npm workspaces root
├── shared/           ← @dis/types, @dis/api, @dis/ws, @dis/store
├── discord-web/      ← Next.js (browser)
└── discord/          ← THIS APP (Expo, mobile)
```

This app imports everything from `shared/`:
- **`@dis/api`** — REST client (`ApiClient`) for login, channels, messages
- **`@dis/ws`** — WebSocket client (`WsClient`) with auto-reconnect and heartbeat
- **`@dis/store`** — Zustand store (`useDisStore`) for all global state
- **`@dis/types`** — TypeScript interfaces shared with the web app

---

## Project Structure

```
discord/
├── app/
│   ├── _layout.tsx         ← Root layout (dark theme, Stack navigator)
│   ├── login.tsx           ← Login + Register screen
│   ├── chat.tsx            ← Main chat screen (channels + messages + input)
│   ├── modal.tsx           ← Modal screen
│   └── (tabs)/
│       ├── _layout.tsx     ← Tab navigator (Home + Explore)
│       ├── index.tsx       ← Home tab
│       └── explore.tsx     ← Explore tab
│
├── components/
│   ├── ChannelList.tsx     ← Sidebar: channel list, WS status indicator, logout
│   ├── ChatWindow.tsx      ← FlatList of messages (natively virtualised)
│   ├── MessageInput.tsx    ← Text input with 2000-char limit + send button
│   ├── themed-text.tsx     ← Theme-aware Text component
│   ├── themed-view.tsx     ← Theme-aware View component
│   ├── haptic-tab.tsx      ← Tab bar button with haptic feedback
│   ├── hello-wave.tsx      ← Animated wave emoji
│   ├── parallax-scroll-view.tsx ← Parallax header component
│   ├── external-link.tsx   ← Opens links in system browser
│   └── ui/
│       ├── collapsible.tsx
│       ├── icon-symbol.tsx
│       └── icon-symbol.ios.tsx
│
├── constants/
│   └── theme.ts            ← Color palette for light/dark themes
│
├── hooks/
│   ├── use-color-scheme.ts
│   ├── use-color-scheme.web.ts
│   └── use-theme-color.ts
│
├── app.json                ← Expo app config (name, slug, icons, splash)
├── metro.config.js         ← Metro bundler config (resolves shared packages)
├── tsconfig.json
└── package.json
```

---

## Key Features

| Feature | Implementation |
|---------|---------------|
| **Native message list** | `FlatList` — React Native's built-in virtualised list |
| **Auto-scroll** | Scrolls to bottom on new messages |
| **Secure token storage** | `expo-secure-store` — encrypted on-device storage (not localStorage) |
| **Foreground/background** | WS disconnects on app background, reconnects on foreground |
| **WS status indicator** | Green/yellow/gray dot in the channel list header |
| **Haptic feedback** | Tab bar buttons trigger device haptics |
| **Dark theme** | React Navigation `DarkTheme` with Discord-like colors |

---

## Auth Flow

1. App opens → Expo Router renders `_layout.tsx` → navigates to `/login` or `/chat`
2. `/chat` checks `expo-secure-store` for a saved token
   - If found: restores auth to Zustand, proceeds to load channels
   - If not found: redirects to `/login`
3. `/login`: user submits credentials → `ApiClient` calls the Rust backend
4. On success: JWT + user stored in `expo-secure-store` + Zustand → navigate to `/chat`
5. Logout: clears SecureStore + Zustand → back to `/login`

---

## WebSocket Lifecycle

The mobile app manages the WebSocket connection around the app lifecycle:

```
App opens → token found → WsClient.connect()
    │
App goes to background → WsClient.destroy()
    │
App returns to foreground → WsClient.connect() (fresh connection)
    │
Active channel changes → subscribe(channelId), fetch message history
```

This avoids keeping a WebSocket open while the app is backgrounded (saves battery, avoids OS-killed connections).

---

## Environment Variables

Create `.env` in this directory:

```
EXPO_PUBLIC_API_URL=http://192.168.x.x:3000
EXPO_PUBLIC_WS_URL=ws://192.168.x.x:3000/ws
```

> **Important:** Replace `192.168.x.x` with your machine's actual LAN IP address. Mobile devices cannot reach `localhost` — that points to the phone itself. Find your IP with `ip addr show` (Linux) or `ipconfig` (Windows).

For running in a web browser or emulator on the same machine, `localhost` works fine.

---

## Running

```bash
# From this directory:
npx expo start

# Or from the monorepo root:
cd ../
npm run dev:mobile
```

Then press:
- **`a`** → Open in Android emulator
- **`i`** → Open in iOS simulator
- **`w`** → Open in web browser
- **Scan QR code** → Open in Expo Go on your phone

> Dependencies must be installed first: run `npm install` from the monorepo root (`discord-app/`).

---

## How It Differs From the Web App

| Aspect | Web (`discord-web`) | Mobile (`discord/`) |
|--------|--------------------|--------------------|
| Message list | `@tanstack/react-virtual` | `FlatList` (native) |
| Token storage | `localStorage` | `expo-secure-store` (encrypted) |
| WS lifecycle | Always connected while tab open | Disconnects on background |
| Styling | Tailwind CSS | React Native StyleSheet |
| Routing | Next.js App Router | Expo Router (file-based) |
| Social features | Full (discover, invites, friends, search) | Basic (channels + chat) |

Both apps share the exact same `@dis/api`, `@dis/ws`, `@dis/store`, and `@dis/types` packages. Any bug fix or feature added in `shared/` applies to both instantly.
