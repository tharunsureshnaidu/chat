import type { ClientMessage, ServerMessage, WsStatus } from '@dis/types';

export type { WsStatus };
export type MessageHandler = (msg: ServerMessage) => void;
export type StatusHandler = (status: WsStatus) => void;

export interface WsClientOptions {
  /** Full ws:// or wss:// URL, e.g. "ws://localhost:3000/ws" */
  wsUrl: string;
  token: string;
  onMessage: MessageHandler;
  onStatus?: StatusHandler;
  /** Heartbeat ping interval in ms (default 25 000) */
  heartbeatInterval?: number;
  /** Initial reconnect delay in ms (default 1 000) */
  reconnectBaseDelay?: number;
  /** Maximum reconnect delay in ms (default 30 000) */
  maxReconnectDelay?: number;
}

export class WsClient {
  private readonly wsUrl: string;
  private readonly token: string;
  private readonly onMessage: MessageHandler;
  private readonly onStatus: StatusHandler;
  private readonly heartbeatInterval: number;
  private readonly reconnectBaseDelay: number;
  private readonly maxReconnectDelay: number;

  private ws: WebSocket | null = null;
  /** Channels this client has subscribed to — restored on every reconnect */
  private readonly subscribedChannels = new Set<string>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(opts: WsClientOptions) {
    this.wsUrl = opts.wsUrl;
    this.token = opts.token;
    this.onMessage = opts.onMessage;
    this.onStatus = opts.onStatus ?? (() => undefined);
    this.heartbeatInterval = opts.heartbeatInterval ?? 25_000;
    this.reconnectBaseDelay = opts.reconnectBaseDelay ?? 1_000;
    this.maxReconnectDelay = opts.maxReconnectDelay ?? 30_000;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  connect(): void {
    if (this.destroyed) return;

    const url = `${this.wsUrl}?token=${encodeURIComponent(this.token)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.onStatus('connected');
      this.startHeartbeat();
      // Restore subscriptions after reconnect
      for (const channelId of this.subscribedChannels) {
        this.sendRaw({ type: 'subscribe', channel_id: channelId });
      }
    };

    this.ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        // Handle pong internally; everything else goes to the caller
        if (msg.type !== 'pong') {
          this.onMessage(msg);
        }
      } catch {
        // Ignore unparseable frames
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      if (!this.destroyed) {
        this.onStatus('reconnecting');
        this.scheduleReconnect();
      } else {
        this.onStatus('disconnected');
      }
    };

    this.ws.onerror = () => {
      // onclose fires after onerror — reconnect logic lives there
      this.ws?.close();
    };
  }

  subscribe(channelId: string): void {
    this.subscribedChannels.add(channelId);
    this.sendRaw({ type: 'subscribe', channel_id: channelId });
  }

  unsubscribe(channelId: string): void {
    this.subscribedChannels.delete(channelId);
    this.sendRaw({ type: 'unsubscribe', channel_id: channelId });
  }

  sendMessage(channelId: string, content: string): void {
    this.sendRaw({ type: 'send_message', channel_id: channelId, content });
  }

  /** Permanently close the connection and stop reconnecting. */
  destroy(): void {
    this.destroyed = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private sendRaw(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendRaw({ type: 'ping' });
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempt += 1;
    // Exponential back-off with jitter: delay * (0.75 – 1.25)
    const base =
      this.reconnectBaseDelay * Math.pow(2, this.reconnectAttempt - 1);
    const capped = Math.min(base, this.maxReconnectDelay);
    const jittered = capped * (0.75 + Math.random() * 0.5);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.destroyed) this.connect();
    }, jittered);
  }
}
