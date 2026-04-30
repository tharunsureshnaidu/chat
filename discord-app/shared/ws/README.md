# @dis/ws — WebSocket Client

A reconnecting WebSocket client that handles the real-time messaging protocol. Provides auto-reconnect with exponential back-off, heartbeat pings, and channel subscription tracking. Used identically by both `discord-web` and `discord`.

---

## Install

Resolved automatically via npm workspaces.

```typescript
import { WsClient } from '@dis/ws';
```

---

## Quick Start

```typescript
import { WsClient } from '@dis/ws';
import type { ServerMessage } from '@dis/types';

const ws = new WsClient({
  wsUrl: 'ws://localhost:3000/ws',
  token: 'eyJhbGci...',
  onMessage: (msg: ServerMessage) => {
    if (msg.type === 'new_message') {
      console.log(`${msg.username}: ${msg.content}`);
    }
  },
  onStatus: (status) => console.log('WS:', status),
});

ws.connect();
ws.subscribe('channel-uuid');
ws.sendMessage('channel-uuid', 'Hello!');

// Later:
ws.destroy(); // permanent close, no reconnect
```

---

## Constructor Options

```typescript
interface WsClientOptions {
  wsUrl: string;              // Full ws:// or wss:// URL
  token: string;              // JWT for authentication
  onMessage: MessageHandler;  // Called for every server message (except pong)
  onStatus?: StatusHandler;   // Called on connection state changes
  heartbeatInterval?: number; // Ping interval in ms (default: 25000)
  reconnectBaseDelay?: number;// Initial reconnect delay in ms (default: 1000)
  maxReconnectDelay?: number; // Max reconnect delay in ms (default: 30000)
}
```

---

## Public Methods

| Method | Description |
|--------|-------------|
| `connect()` | Open the WebSocket connection. No-op if `destroy()` was called. |
| `subscribe(channelId)` | Subscribe to a channel. Stored internally — restored after reconnect. |
| `unsubscribe(channelId)` | Unsubscribe from a channel. |
| `sendMessage(channelId, content)` | Send a chat message via WebSocket. |
| `destroy()` | Permanently close the connection. Stops heartbeat and reconnect. |

---

## Reconnect Behavior

On disconnect (not caused by `destroy()`):

1. Status changes to `'reconnecting'`
2. Wait: `min(baseDelay * 2^(attempt-1), maxDelay) * random(0.75, 1.25)`
3. Reconnect attempt
4. On success: status → `'connected'`, all tracked subscriptions re-sent
5. On failure: repeat from step 2

```
Attempt 1 → ~1s
Attempt 2 → ~2s
Attempt 3 → ~4s
Attempt 4 → ~8s
...capped at 30s
```

The jitter (0.75–1.25x) prevents thundering herd when many clients reconnect simultaneously (e.g. after a server restart).

---

## Heartbeat

A `ping` message is sent every 25 seconds (configurable). The server responds with `pong`, which is handled internally and not forwarded to `onMessage`.

If the server doesn't respond and the connection drops, the `onclose` handler triggers the reconnect sequence.

---

## Authentication

The JWT is passed as a query parameter: `ws://host/ws?token=<jwt>`.

This is required because the browser `WebSocket` API does not support custom headers. The backend validates the token before completing the HTTP → WS upgrade. Invalid tokens receive a `401` HTTP response (no WebSocket connection established).

---

## Message Types

### Sent by client (via this class)

| Type | When |
|------|------|
| `subscribe` | `subscribe()` called |
| `unsubscribe` | `unsubscribe()` called |
| `send_message` | `sendMessage()` called |
| `ping` | Automatic heartbeat |

### Received from server (forwarded to `onMessage`)

| Type | Description |
|------|-------------|
| `new_message` | A new chat message in a subscribed channel |
| `subscribed` | Confirmation of channel subscription |
| `unsubscribed` | Confirmation of channel unsubscription |
| `error` | Server-side error message |
| `channel_invite_received` | You were invited to a channel |
| `friend_request_received` | Someone sent you a friend request |
| `friend_request_accepted` | Your friend request was accepted |
| `join_request_approved` | Your join request was approved |
| `join_request_rejected` | Your join request was rejected |

`pong` is handled internally and never forwarded.

---

## Design Notes

- The class is stateful: it tracks subscribed channels and reconnect state
- `subscribedChannels` is a `Set<string>` — subscriptions persist across reconnects
- `sendRaw()` silently drops messages if the socket isn't open (no queue)
- The class uses the browser-native `WebSocket` API (works in both ReactDOM and React Native)
- One instance per authenticated session — create a new one after logout/re-login
