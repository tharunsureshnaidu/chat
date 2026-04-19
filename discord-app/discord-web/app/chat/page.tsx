'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClient } from '@dis/api';
import { WsClient } from '@dis/ws';
import { useDisStore } from '@dis/store';
import type { ServerMessage, ChannelSummary } from '@dis/types';
import ChannelList from '@/components/ChannelList';
import ChatWindow from '@/components/ChatWindow';
import MessageInput from '@/components/MessageInput';
import DiscoverModal from '@/components/DiscoverModal';
import CreateChannelModal from '@/components/CreateChannelModal';

const api = new ApiClient(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'
);
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3000/ws';

export default function ChatPage() {
  const router = useRouter();
  const wsRef = useRef<WsClient | null>(null);

  const [showDiscover, setShowDiscover] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  // Tracks channels where the user has a pending join request
  const [pendingJoinChannels, setPendingJoinChannels] = useState<Set<string>>(new Set());

  const token = useDisStore((s) => s.token);
  const user = useDisStore((s) => s.user);
  const setAuth = useDisStore((s) => s.setAuth);
  const setChannels = useDisStore((s) => s.setChannels);
  const addChannel = useDisStore((s) => s.addChannel);
  const setDMs = useDisStore((s) => s.setDMs);
  const addDM = useDisStore((s) => s.addDM);
  const addMessage = useDisStore((s) => s.addMessage);
  const setWsStatus = useDisStore((s) => s.setWsStatus);
  const activeChannelId = useDisStore((s) => s.activeChannelId);
  const setActiveChannel = useDisStore((s) => s.setActiveChannel);
  const setMessages = useDisStore((s) => s.setMessages);
  const setFriends = useDisStore((s) => s.setFriends);
  const addFriend = useDisStore((s) => s.addFriend);
  const setPendingFriendRequests = useDisStore((s) => s.setPendingFriendRequests);
  const addFriendRequest = useDisStore((s) => s.addFriendRequest);
  const setPendingInvites = useDisStore((s) => s.setPendingInvites);
  const addInvite = useDisStore((s) => s.addInvite);
  const incrementSocialBadge = useDisStore((s) => s.incrementSocialBadge);
  const markUnread = useDisStore((s) => s.markUnread);

  // ── 1. Restore auth from localStorage ─────────────────────────────────────
  useEffect(() => {
    if (token) {
      api.setToken(token);
      return;
    }
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (storedToken && storedUser) {
      try {
        setAuth(storedToken, JSON.parse(storedUser));
        api.setToken(storedToken);
      } catch {
        router.replace('/login');
      }
    } else {
      router.replace('/login');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 2. Load channels, DMs, friends, invites once auth is ready ─────────────
  useEffect(() => {
    if (!token) return;
    // Always sync the token to the api singleton before fetching (guards
    // against StrictMode double-invoke and store-rehydration races).
    api.setToken(token);
    // discoverChannels returns ALL public channels with my_role set if joined.
    // We also fetch private joined channels that won't appear in discover.
    Promise.all([api.discoverChannels(), api.fetchMyChannels()])
      .then(([publicChs, myChs]) => {
        const merged = new Map<string, import('@dis/types').ChannelSummary>();
        for (const ch of publicChs) merged.set(ch.id, ch);
        for (const ch of myChs) {
          if (!merged.has(ch.id)) merged.set(ch.id, ch);
        }
        const all = Array.from(merged.values());
        setChannels(all);
        // Subscribe to all joined channels for background unread tracking
        for (const ch of all) {
          if (ch.my_role) wsRef.current?.subscribe(ch.id);
        }
      })
      .catch(console.error);
    api.fetchMyDMs().then((dms) => {
      setDMs(dms);
      // Subscribe to all DMs for background unread tracking
      for (const dm of dms) wsRef.current?.subscribe(dm.id);
    }).catch(console.error);
    api.fetchFriends().then(setFriends).catch(console.error);
    api.fetchFriendRequests().then(setPendingFriendRequests).catch(console.error);
    api.fetchMyInvites().then(setPendingInvites).catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── 3. Connect WebSocket ───────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    const ws = new WsClient({
      wsUrl: WS_URL,
      token,
      onMessage: (msg: ServerMessage) => {
        switch (msg.type) {
          case 'new_message':
            addMessage(msg.channel_id, {
              id: msg.id,
              channel_id: msg.channel_id,
              user_id: msg.user_id,
              username: msg.username,
              content: msg.content,
              created_at: msg.timestamp,
            });
            // Mark unread if this message is not in the currently active channel
            if (msg.channel_id !== useDisStore.getState().activeChannelId) {
              markUnread(msg.channel_id);
            }
            break;

          case 'channel_invite_received':
            addInvite({
              id: crypto.randomUUID(),
              channel_id: msg.channel_id,
              channel_name: msg.channel_name,
              inviter_id: '',
              inviter_username: msg.inviter_username,
              status: 'pending',
              created_at: new Date().toISOString(),
            });
            incrementSocialBadge();
            break;

          case 'friend_request_received':
            addFriendRequest({
              id: crypto.randomUUID(),
              sender_id: msg.sender_id,
              sender_username: msg.sender_username,
              receiver_id: '',
              receiver_username: '',
              status: 'pending',
              created_at: new Date().toISOString(),
            });
            incrementSocialBadge();
            break;

          case 'join_request_approved':
            // Only need the joined-channels list (my_role is now set);
            // no need to re-fetch all public discover channels.
            api.fetchMyChannels()
              .then((myChs) => {
                for (const ch of myChs) {
                  addChannel(ch);
                  wsRef.current?.subscribe(ch.id);
                }
              })
              .catch(console.error);
            break;

          case 'friend_request_accepted':
            addFriend({
              friend_id: msg.friend_id,
              username: msg.friend_username,
              dm_channel_id: msg.dm_channel_id,
              created_at: new Date().toISOString(),
            });
            if (msg.dm_channel_id) {
              wsRef.current?.subscribe(msg.dm_channel_id);
              api.fetchMyDMs().then((dms) => {
                setDMs(dms);
                for (const dm of dms) wsRef.current?.subscribe(dm.id);
              }).catch(console.error);
            }
            break;
        }
      },
      onStatus: setWsStatus,
    });

    ws.connect();
    wsRef.current = ws;

    // Auto-subscribe to all already-loaded joined channels + DMs so background
    // messages trigger unread badges even for channels never explicitly opened.
    const { channels: loadedChannels, dms: loadedDMs } = useDisStore.getState();
    for (const ch of loadedChannels) {
      if (ch.my_role) ws.subscribe(ch.id);
    }
    for (const dm of loadedDMs) {
      ws.subscribe(dm.id);
    }

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── 4. Subscribe to active channel + load history ──────────────────────────
  useEffect(() => {
    if (!activeChannelId) return;

    // clearUnread is a stable Zustand action — access via getState() to keep
    // the deps array size constant (avoids React's "changed size" error).
    useDisStore.getState().clearUnread(activeChannelId);
    wsRef.current?.subscribe(activeChannelId);

    // Don't attempt to fetch messages for private channels we're not a member
    // of — the backend will 401 and there's nothing to show anyway.
    const { channels, dms } = useDisStore.getState();
    const ch =
      channels.find((c) => c.id === activeChannelId) ??
      dms.find((c) => c.id === activeChannelId);
    const isMember = !!ch?.my_role || !!ch?.is_direct;

    if (isMember) {
      api
        .fetchMessages(activeChannelId)
        .then((msgs) => setMessages(activeChannelId, msgs))
        .catch(console.error);
    }

    return () => {
      // Only unsubscribe for public channels the user is browsing WITHOUT
      // being a member (e.g. previewing before joining).
      // Members MUST stay subscribed so the server keeps broadcasting new
      // messages to them for background unread-badge tracking — navigating
      // to another channel must NOT cut off delivery for channels they belong to.
      if (!isMember) {
        wsRef.current?.unsubscribe(activeChannelId);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannelId, setMessages]);

  // ── 5. Send message (optimistic update) ───────────────────────────────────
  const handleSend = useCallback(
    (content: string) => {
      if (!activeChannelId || !wsRef.current || !user) return;
      // Add a pending message immediately so the UI responds without waiting
      // for the Kafka → DB → Redis → WS round-trip (~100–300 ms).
      // addMessage detects the pending flag and auto-confirms it when the
      // echoed server message arrives (same user_id + content match).
      addMessage(activeChannelId, {
        id: crypto.randomUUID(),
        channel_id: activeChannelId,
        user_id: user.id,
        username: user.username,
        content,
        created_at: new Date().toISOString(),
        pending: true,
      });
      wsRef.current.sendMessage(activeChannelId, content);
    },
    [activeChannelId, user, addMessage]
  );

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handleChannelJoined(channel: ChannelSummary) {
    if (channel.is_direct) {
      addDM(channel);
    } else {
      addChannel(channel);
    }
    wsRef.current?.subscribe(channel.id);
    setActiveChannel(channel.id);
    setShowDiscover(false);
  }

  function handleChannelCreated(channel: ChannelSummary) {
    addChannel(channel);
    wsRef.current?.subscribe(channel.id);
    setActiveChannel(channel.id);
  }

  async function handleJoinActive() {
    if (!activeChannelId) return;
    try {
      await api.joinChannel(activeChannelId);
      // Refresh to get updated my_role (public channel = now a member)
      const updated = await api.discoverChannels();
      const joined = updated.find((c) => c.id === activeChannelId);
      if (joined) addChannel(joined);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // "already pending" is a success state for private channels
      if (msg.includes('already pending') || msg.includes('pending')) {
        setPendingJoinChannels((prev) => new Set(prev).add(activeChannelId));
      } else {
        console.error('Join failed:', e);
      }
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-[#313338] text-white overflow-hidden">
      <ChannelList
        onDiscover={() => setShowDiscover(true)}
        onCreateChannel={() => setShowCreateChannel(true)}
      />

      <main className="flex flex-col flex-1 min-w-0">
        {activeChannelId ? (
          <>
            <ChatWindow channelId={activeChannelId} />
            <MessageInput
              onSend={handleSend}
              onJoin={handleJoinActive}
              joinPending={!!activeChannelId && pendingJoinChannels.has(activeChannelId)}
            />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[#949ba4]">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="opacity-30"
            >
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
            </svg>
            <p className="text-sm">Select a channel to start chatting</p>
            <button
              onClick={() => setShowDiscover(true)}
              className="mt-1 px-4 py-2 bg-[#5865f2] text-white rounded text-sm font-medium hover:bg-[#4752c4] transition"
            >
              Discover channels
            </button>
          </div>
        )}
      </main>

      {showDiscover && (
        <DiscoverModal
          api={api}
          onClose={() => setShowDiscover(false)}
          onChannelJoined={handleChannelJoined}
        />
      )}

      {showCreateChannel && (
        <CreateChannelModal
          api={api}
          onClose={() => setShowCreateChannel(false)}
          onCreated={handleChannelCreated}
        />
      )}
    </div>
  );
}
