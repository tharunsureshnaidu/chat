import { useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, AppState, type AppStateStatus } from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { ApiClient } from '@dis/api';
import { WsClient } from '@dis/ws';
import { useDisStore } from '@dis/store';
import type { ServerMessage } from '@dis/types';
import ChannelList from '@/components/ChannelList';
import ChatWindow from '@/components/ChatWindow';
import MessageInput from '@/components/MessageInput';

const api = new ApiClient(
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'
);
const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'ws://localhost:3000/ws';

export default function ChatScreen() {
  const router = useRouter();
  const wsRef = useRef<WsClient | null>(null);

  const token = useDisStore((s) => s.token);
  const user = useDisStore((s) => s.user);
  const setAuth = useDisStore((s) => s.setAuth);
  const setChannels = useDisStore((s) => s.setChannels);
  const addMessage = useDisStore((s) => s.addMessage);
  const setWsStatus = useDisStore((s) => s.setWsStatus);
  const activeChannelId = useDisStore((s) => s.activeChannelId);
  const setMessages = useDisStore((s) => s.setMessages);

  // ── 1. Restore auth from SecureStore ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (token) {
        api.setToken(token);
        return;
      }
      try {
        const storedToken = await SecureStore.getItemAsync('token');
        const storedUser = await SecureStore.getItemAsync('user');
        if (storedToken && storedUser) {
          setAuth(storedToken, JSON.parse(storedUser));
          api.setToken(storedToken);
        } else {
          router.replace('/login');
        }
      } catch {
        router.replace('/login');
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 2. Fetch channels ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    api.fetchChannels().then(setChannels).catch(console.error);
  }, [token, setChannels]);

  // ── 3. WebSocket connect / disconnect ─────────────────────────────────────────
  const connectWs = useCallback(
    (currentToken: string) => {
      const ws = new WsClient({
        wsUrl: WS_URL,
        token: currentToken,
        onMessage: (msg: ServerMessage) => {
          if (msg.type === 'new_message') {
            addMessage(msg.channel_id, {
              id: msg.id,
              channel_id: msg.channel_id,
              user_id: msg.user_id,
              username: msg.username,
              content: msg.content,
              created_at: msg.timestamp,
            });
          }
        },
        onStatus: setWsStatus,
      });
      ws.connect();
      wsRef.current = ws;
    },
    [addMessage, setWsStatus]
  );

  useEffect(() => {
    if (!token) return;
    connectWs(token);
    return () => {
      wsRef.current?.destroy();
      wsRef.current = null;
    };
  }, [token, connectWs]);

  // ── 4. Reconnect WS on foreground resume ──────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && !wsRef.current) {
        connectWs(token);
      } else if (next === 'background') {
        wsRef.current?.destroy();
        wsRef.current = null;
        setWsStatus('disconnected');
      }
    });
    return () => sub.remove();
  }, [token, connectWs, setWsStatus]);

  // ── 5. Subscribe to active channel + load history ────────────────────────────
  useEffect(() => {
    if (!activeChannelId) return;
    wsRef.current?.subscribe(activeChannelId);
    api
      .fetchMessages(activeChannelId)
      .then((msgs) => setMessages(activeChannelId, msgs))
      .catch(console.error);
    return () => {
      wsRef.current?.unsubscribe(activeChannelId);
    };
  }, [activeChannelId, setMessages]);

  // ── 6. Send message ───────────────────────────────────────────────────────────
  const handleSend = useCallback(
    (content: string) => {
      if (!activeChannelId || !wsRef.current) return;
      wsRef.current.sendMessage(activeChannelId, content);
    },
    [activeChannelId]
  );

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <ChannelList />
      <View style={styles.main}>
        {activeChannelId ? (
          <>
            <ChatWindow channelId={activeChannelId} />
            <MessageInput onSend={handleSend} />
          </>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Select a channel to start chatting</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: '#313338' },
  main: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#949ba4', fontSize: 14 },
});
