import { create } from 'zustand';
import type {
  User,
  ChannelSummary,
  ChannelInvite,
  FriendRequest,
  Friend,
  Message,
  WsStatus,
} from '@dis/types';

// ─── State shape ─────────────────────────────────────────────────────────────

interface MessagesMap {
  [channelId: string]: Message[];
}

export interface DisStore {
  // ── Auth ──────────────────────────────────────────────────────────────────
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  clearAuth: () => void;

  // ── Channels (my joined non-DM channels) ──────────────────────────────────
  channels: ChannelSummary[];
  setChannels: (channels: ChannelSummary[]) => void;
  addChannel: (channel: ChannelSummary) => void;

  // ── DMs ───────────────────────────────────────────────────────────────────
  dms: ChannelSummary[];
  setDMs: (dms: ChannelSummary[]) => void;
  addDM: (dm: ChannelSummary) => void;

  // ── Active channel ────────────────────────────────────────────────────────
  activeChannelId: string | null;
  setActiveChannel: (id: string | null) => void;

  // ── Messages ──────────────────────────────────────────────────────────────
  messages: MessagesMap;
  setMessages: (channelId: string, messages: Message[]) => void;
  addMessage: (channelId: string, message: Message) => void;
  confirmMessage: (channelId: string, tempId: string, confirmed: Message) => void;

  // ── Social ────────────────────────────────────────────────────────────────
  friends: Friend[];
  setFriends: (friends: Friend[]) => void;
  addFriend: (friend: Friend) => void;

  pendingFriendRequests: FriendRequest[];
  setPendingFriendRequests: (reqs: FriendRequest[]) => void;
  addFriendRequest: (req: FriendRequest) => void;
  removeFriendRequest: (id: string) => void;

  pendingInvites: ChannelInvite[];
  setPendingInvites: (invites: ChannelInvite[]) => void;
  addInvite: (invite: ChannelInvite) => void;
  removeInvite: (id: string) => void;

  /** Total unread social notifications (invites + friend requests) */
  socialBadge: number;
  setSocialBadge: (n: number) => void;
  incrementSocialBadge: () => void;
  clearSocialBadge: () => void;

  /** Unread message counts per channel */
  unread: Record<string, number>;
  markUnread: (channelId: string) => void;
  clearUnread: (channelId: string) => void;

  // ── WebSocket status ──────────────────────────────────────────────────────
  wsStatus: WsStatus;
  setWsStatus: (status: WsStatus) => void;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useDisStore = create<DisStore>()((set) => ({
  // ── Auth ──────────────────────────────────────────────────────────────────
  token: null,
  user: null,
  setAuth: (token, user) => set({ token, user }),
  clearAuth: () => set({ token: null, user: null }),

  // ── Channels ──────────────────────────────────────────────────────────────
  channels: [],
  setChannels: (channels) => set({ channels }),
  addChannel: (channel) =>
    set((s) => ({
      channels: s.channels.some((c) => c.id === channel.id)
        ? s.channels.map((c) => (c.id === channel.id ? channel : c))
        : [...s.channels, channel],
    })),

  // ── DMs ───────────────────────────────────────────────────────────────────
  dms: [],
  setDMs: (dms) => set({ dms }),
  addDM: (dm) =>
    set((s) => ({
      dms: s.dms.some((d) => d.id === dm.id) ? s.dms : [...s.dms, dm],
    })),

  // ── Active channel ────────────────────────────────────────────────────────
  activeChannelId: null,
  setActiveChannel: (id) => set({ activeChannelId: id }),

  // ── Messages ──────────────────────────────────────────────────────────────
  messages: {},
  setMessages: (channelId, fetched) =>
    set((s) => {
      const existing = s.messages[channelId] ?? [];
      const merged = [...fetched];
      for (const msg of existing) {
        if (!merged.some((m) => m.id === msg.id)) merged.push(msg);
      }
      merged.sort((a, b) =>
        a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
      );
      return { messages: { ...s.messages, [channelId]: merged } };
    }),
  addMessage: (channelId, message) =>
    set((s) => {
      const existing = s.messages[channelId] ?? [];
      if (existing.some((m) => m.id === message.id)) return s;
      if (!message.pending && message.user_id) {
        const pendingIdx = existing.findIndex(
          (m) =>
            m.pending &&
            m.user_id === message.user_id &&
            m.content === message.content
        );
        if (pendingIdx !== -1) {
          const updated = [...existing];
          updated[pendingIdx] = message;
          return { messages: { ...s.messages, [channelId]: updated } };
        }
      }
      return { messages: { ...s.messages, [channelId]: [...existing, message] } };
    }),
  confirmMessage: (channelId, tempId, confirmed) =>
    set((s) => {
      const existing = s.messages[channelId] ?? [];
      const replaced = existing.map((m) => (m.temp_id === tempId ? confirmed : m));
      const alreadyPresent = replaced.some((m) => m.id === confirmed.id);
      return {
        messages: {
          ...s.messages,
          [channelId]: alreadyPresent ? replaced : [...replaced, confirmed],
        },
      };
    }),

  // ── Social ────────────────────────────────────────────────────────────────
  friends: [],
  setFriends: (friends) => set({ friends }),
  addFriend: (friend) =>
    set((s) => ({
      friends: s.friends.some((f) => f.friend_id === friend.friend_id)
        ? s.friends
        : [...s.friends, friend],
    })),

  pendingFriendRequests: [],
  setPendingFriendRequests: (reqs) => set({ pendingFriendRequests: reqs }),
  addFriendRequest: (req) =>
    set((s) => ({
      pendingFriendRequests: s.pendingFriendRequests.some((r) => r.id === req.id)
        ? s.pendingFriendRequests
        : [...s.pendingFriendRequests, req],
    })),
  removeFriendRequest: (id) =>
    set((s) => ({
      pendingFriendRequests: s.pendingFriendRequests.filter((r) => r.id !== id),
    })),

  pendingInvites: [],
  setPendingInvites: (invites) => set({ pendingInvites: invites }),
  addInvite: (invite) =>
    set((s) => ({
      pendingInvites: s.pendingInvites.some((i) => i.id === invite.id)
        ? s.pendingInvites
        : [...s.pendingInvites, invite],
    })),
  removeInvite: (id) =>
    set((s) => ({
      pendingInvites: s.pendingInvites.filter((i) => i.id !== id),
    })),

  socialBadge: 0,
  setSocialBadge: (n) => set({ socialBadge: n }),
  incrementSocialBadge: () => set((s) => ({ socialBadge: s.socialBadge + 1 })),
  clearSocialBadge: () => set({ socialBadge: 0 }),

  unread: {},
  markUnread: (channelId) =>
    set((s) => ({
      unread: { ...s.unread, [channelId]: (s.unread[channelId] ?? 0) + 1 },
    })),
  clearUnread: (channelId) =>
    set((s) => {
      const next = { ...s.unread };
      delete next[channelId];
      return { unread: next };
    }),

  // ── WebSocket status ──────────────────────────────────────────────────────
  wsStatus: 'disconnected',
  setWsStatus: (status) => set({ wsStatus: status }),
}));

// ─── Selectors (for minimal re-renders) ──────────────────────────────────────

export const selectUser = (s: DisStore) => s.user;
export const selectToken = (s: DisStore) => s.token;
export const selectChannels = (s: DisStore) => s.channels;
export const selectDMs = (s: DisStore) => s.dms;
export const selectFriends = (s: DisStore) => s.friends;
export const selectActiveChannelId = (s: DisStore) => s.activeChannelId;
export const selectWsStatus = (s: DisStore) => s.wsStatus;
export const selectSocialBadge = (s: DisStore) => s.socialBadge;
export const selectMessages =
  (channelId: string) =>
  (s: DisStore): Message[] =>
    s.messages[channelId] ?? [];
