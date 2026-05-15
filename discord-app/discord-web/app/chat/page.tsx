'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClient } from '@dis/api';
import { WsClient } from '@dis/ws';
import { useDisStore } from '@dis/store';
import type { ServerMessage, ChannelSummary } from '@dis/types';
import ChannelList from '@/components/ChannelList';
import ChannelHeader from '@/components/ChannelHeader';
import ChatWindow from '@/components/ChatWindow';
import MessageInput from '@/components/MessageInput';
import MembersPanel from '@/components/MembersPanel';
import DiscoverModal from '@/components/DiscoverModal';
import CreateChannelModal from '@/components/CreateChannelModal';
import ChannelSettingsModal from '@/components/ChannelSettingsModal';
import { ToastHost } from '@/components/ui/ToastHost';
import { toast } from '@/lib/toast';

const api = new ApiClient(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'
);
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3000/ws';

export default function ChatPage() {
  const router = useRouter();
  const wsRef = useRef<WsClient | null>(null);

  const [showDiscover, setShowDiscover] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [showSidebarMobile, setShowSidebarMobile] = useState(false);
  // Tracks channels where the user has a pending join request
  const [pendingJoinChannels, setPendingJoinChannels] = useState<Set<string>>(new Set());

  const token = useDisStore((s) => s.token);
  const user = useDisStore((s) => s.user);
  const setAuth = useDisStore((s) => s.setAuth);
  const setChannels = useDisStore((s) => s.setChannels);
  const addChannel = useDisStore((s) => s.addChannel);
  const removeChannel = useDisStore((s) => s.removeChannel);
  const setDMs = useDisStore((s) => s.setDMs);
  const addDM = useDisStore((s) => s.addDM);
  const removeDM = useDisStore((s) => s.removeDM);
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

  const channels = useDisStore((s) => s.channels);
  const dms = useDisStore((s) => s.dms);

  const activeChannel = useMemo(
    () =>
      activeChannelId
        ? channels.find((c) => c.id === activeChannelId) ??
          dms.find((c) => c.id === activeChannelId)
        : undefined,
    [activeChannelId, channels, dms]
  );

  const isActiveMember =
    !!activeChannel?.my_role || !!activeChannel?.is_direct;

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
    api.setToken(token);
    Promise.all([api.discoverChannels(), api.fetchMyChannels()])
      .then(([publicChs, myChs]) => {
        const merged = new Map<string, ChannelSummary>();
        for (const ch of publicChs) merged.set(ch.id, ch);
        for (const ch of myChs) {
          if (!merged.has(ch.id)) merged.set(ch.id, ch);
        }
        const all = Array.from(merged.values());
        setChannels(all);
        for (const ch of all) {
          if (ch.my_role) wsRef.current?.subscribe(ch.id);
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
    api
      .fetchMyDMs()
      .then((d) => {
        setDMs(d);
        for (const dm of d) wsRef.current?.subscribe(dm.id);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
    api.fetchFriends().then(setFriends).catch(() => undefined);
    api.fetchFriendRequests().then(setPendingFriendRequests).catch(() => undefined);
    api.fetchMyInvites().then(setPendingInvites).catch(() => undefined);
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
            toast.info(`${msg.inviter_username} invited you to #${msg.channel_name}`);
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
            toast.info(`${msg.sender_username} sent you a friend request`);
            break;

          case 'join_request_approved':
            api
              .fetchMyChannels()
              .then((myChs) => {
                for (const ch of myChs) {
                  addChannel(ch);
                  wsRef.current?.subscribe(ch.id);
                }
              })
              .catch(() => undefined);
            toast.success('Your join request was approved');
            break;

          case 'join_request_rejected':
            toast.info('A join request was declined');
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
              api
                .fetchMyDMs()
                .then((d) => {
                  setDMs(d);
                  for (const dm of d) wsRef.current?.subscribe(dm.id);
                })
                .catch(() => undefined);
            }
            toast.success(`You're now friends with ${msg.friend_username}`);
            break;

          case 'error':
            toast.error(msg.message);
            break;
        }
      },
      onStatus: setWsStatus,
    });

    ws.connect();
    wsRef.current = ws;

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

    useDisStore.getState().clearUnread(activeChannelId);
    wsRef.current?.subscribe(activeChannelId);

    const { channels, dms } = useDisStore.getState();
    const ch =
      channels.find((c) => c.id === activeChannelId) ??
      dms.find((c) => c.id === activeChannelId);
    const isMember = !!ch?.my_role || !!ch?.is_direct;

    if (isMember) {
      api
        .fetchMessages(activeChannelId)
        .then((msgs) => setMessages(activeChannelId, msgs))
        .catch((e) =>
          toast.error(e instanceof Error ? e.message : 'Failed to load messages')
        );
    }

    return () => {
      // Members must remain subscribed for background unread tracking;
      // only unsubscribe channels we are merely previewing.
      if (!isMember) {
        wsRef.current?.unsubscribe(activeChannelId);
      }
    };
  }, [activeChannelId, setMessages]);

  // ── 5. Send message (optimistic update) ───────────────────────────────────
  const handleSend = useCallback(
    (content: string) => {
      if (!activeChannelId || !wsRef.current || !user) return;
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
    if (channel.is_direct) addDM(channel);
    else addChannel(channel);
    wsRef.current?.subscribe(channel.id);
    setActiveChannel(channel.id);
    setShowDiscover(false);
  }

  function handleChannelCreated(channel: ChannelSummary) {
    addChannel(channel);
    wsRef.current?.subscribe(channel.id);
    setActiveChannel(channel.id);
  }

  function handleChannelUpdated(channel: ChannelSummary) {
    addChannel(channel);
  }

  function handleChannelLeftOrDeleted(id: string) {
    const wasDM = useDisStore.getState().dms.some((d) => d.id === id);
    if (wasDM) removeDM(id);
    else removeChannel(id);
    wsRef.current?.unsubscribe(id);
  }

  async function handleJoinActive() {
    if (!activeChannelId) return;
    try {
      await api.joinChannel(activeChannelId);
      const updated = await api.discoverChannels();
      const joined = updated.find((c) => c.id === activeChannelId);
      if (joined?.my_role) {
        addChannel(joined);
        toast.success(`Joined #${joined.name}`);
      } else if (joined) {
        addChannel(joined);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes('pending')) {
        setPendingJoinChannels((prev) => new Set(prev).add(activeChannelId));
        toast.info('Join request sent');
      } else {
        toast.error(msg);
      }
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-[#313338] text-white overflow-hidden">
      {/* Sidebar — always visible on md+, slides in on mobile */}
      <div
        className={`${
          showSidebarMobile ? 'flex' : 'hidden'
        } md:flex shrink-0 absolute md:relative inset-y-0 left-0 z-30`}
      >
        <ChannelList
          onDiscover={() => setShowDiscover(true)}
          onCreateChannel={() => setShowCreateChannel(true)}
          onPickChannel={() => setShowSidebarMobile(false)}
        />
      </div>
      {showSidebarMobile && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-20"
          onClick={() => setShowSidebarMobile(false)}
        />
      )}

      <main className="flex flex-col flex-1 min-w-0">
        {activeChannelId && activeChannel ? (
          <>
            <ChannelHeader
              showMembers={showMembers}
              onToggleMembers={() => setShowMembers((v) => !v)}
              onOpenSettings={() => setShowSettings(true)}
              onToggleSidebar={() => setShowSidebarMobile((v) => !v)}
            />
            <div className="flex flex-1 min-h-0">
              <div className="flex flex-col flex-1 min-w-0">
                <ChatWindow
                  channelId={activeChannelId}
                  api={api}
                  isMember={isActiveMember}
                />
                <MessageInput
                  onSend={handleSend}
                  onJoin={handleJoinActive}
                  joinPending={pendingJoinChannels.has(activeChannelId)}
                />
              </div>
              {!activeChannel.is_direct && (
                <MembersPanel
                  channelId={activeChannelId}
                  api={api}
                  visible={showMembers && isActiveMember}
                />
              )}
            </div>
          </>
        ) : (
          <EmptyState
            onDiscover={() => setShowDiscover(true)}
            onCreate={() => setShowCreateChannel(true)}
            onToggleSidebar={() => setShowSidebarMobile(true)}
          />
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

      {showSettings && activeChannel && (
        <ChannelSettingsModal
          api={api}
          channel={activeChannel}
          onClose={() => setShowSettings(false)}
          onChannelUpdated={handleChannelUpdated}
          onLeftOrDeleted={handleChannelLeftOrDeleted}
        />
      )}

      <ToastHost />
    </div>
  );
}

function EmptyState({
  onDiscover,
  onCreate,
  onToggleSidebar,
}: {
  onDiscover: () => void;
  onCreate: () => void;
  onToggleSidebar: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col">
      <header className="md:hidden h-12 px-4 flex items-center bg-[#313338] border-b border-black/30">
        <button onClick={onToggleSidebar} className="text-[#b5bac1] hover:text-white">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 6h18v2H3zM3 11h18v2H3zM3 16h18v2H3z" />
          </svg>
        </button>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[#949ba4] px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-linear-to-br from-[#5865f2] to-[#7289da] flex items-center justify-center shadow-lg shadow-[#5865f2]/30">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-white">Welcome to Dis</h2>
        <p className="text-sm max-w-sm">
          Pick a channel from the sidebar to start chatting, or browse public
          channels to discover something new.
        </p>
        <div className="flex gap-2 mt-2">
          <button
            onClick={onDiscover}
            className="px-4 py-2 bg-[#5865f2] text-white rounded-lg text-sm font-semibold hover:bg-[#4752c4] transition"
          >
            Discover channels
          </button>
          <button
            onClick={onCreate}
            className="px-4 py-2 bg-[#383a40] text-white rounded-lg text-sm font-semibold hover:bg-[#404249] transition"
          >
            Create one
          </button>
        </div>
      </div>
    </div>
  );
}
