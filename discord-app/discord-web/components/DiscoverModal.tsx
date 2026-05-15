/**
 * DiscoverModal — Multi-tab modal for social features.
 *
 * Tabs:
 * 1. Channels — Browse/search public channels, join or request access
 * 2. Requests — Incoming channel invites, friend requests, admin join-requests
 * 3. Search  — Find users by username, send friend requests
 *
 * Clears the social notification badge on open.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { ApiClient } from '@dis/api';
import { useDisStore } from '@dis/store';
import type { ChannelSummary, ChannelInvite, FriendRequest, JoinRequest, UserResult, Friend } from '@dis/types';

type Tab = 'channels' | 'requests' | 'search';

interface Props {
  api: ApiClient;
  onClose: () => void;
  onChannelJoined: (channel: ChannelSummary) => void;
}

export default function DiscoverModal({ api, onClose, onChannelJoined }: Props) {
  const [tab, setTab] = useState<Tab>('channels');
  const [channelQuery, setChannelQuery] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [allChannels, setAllChannels] = useState<ChannelSummary[]>([]);
  const [invites, setInvites] = useState<ChannelInvite[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [adminJoinRequests, setAdminJoinRequests] = useState<JoinRequest[]>([]);
  const [searchResults, setSearchResults] = useState<UserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());

  const clearSocialBadge = useDisStore((s) => s.clearSocialBadge);
  const removeInvite = useDisStore((s) => s.removeInvite);
  const removeFriendRequest = useDisStore((s) => s.removeFriendRequest);
  const addFriend = useDisStore((s) => s.addFriend);
  const storeFriends = useDisStore((s) => s.friends);

  function isFriend(userId: string): boolean {
    return storeFriends.some((f: Friend) => f.friend_id === userId);
  }

  const loadChannels = useCallback(async (q?: string) => {
    setLoading(true);
    setError(null);
    try {
      setAllChannels(await api.discoverChannels(q));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [inv, fr, jr] = await Promise.all([
        api.fetchMyInvites(),
        api.fetchFriendRequests(),
        api.fetchAllAdminJoinRequests(),
      ]);
      setInvites(inv);
      setFriendRequests(fr);
      setAdminJoinRequests(jr);
      clearSocialBadge();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [api, clearSocialBadge]);

  useEffect(() => {
    if (tab === 'channels') loadChannels();
    if (tab === 'requests') loadRequests();
  }, [tab, loadChannels, loadRequests]);

  useEffect(() => {
    if (tab !== 'channels') return;
    const t = setTimeout(() => loadChannels(channelQuery || undefined), 300);
    return () => clearTimeout(t);
  }, [channelQuery, tab, loadChannels]);

  useEffect(() => {
    if (tab !== 'search' || userQuery.trim().length < 2) {
      if (tab === 'search') setSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try { setSearchResults(await api.searchUsers(userQuery)); }
      catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [userQuery, tab, api]);

  async function handleJoin(channelId: string, isMember: boolean) {
    if (isMember) return;
    setActionLoading(channelId);
    setError(null);
    try {
      await api.joinChannel(channelId);
      const updated = await api.discoverChannels(channelQuery || undefined);
      setAllChannels(updated);
      const joined = updated.find((c) => c.id === channelId);
      if (joined && joined.my_role) onChannelJoined(joined);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('pending')) {
        setSentRequests((p) => new Set(p).add(channelId));
      } else {
        setError(msg);
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function handleInviteResponse(inviteId: string, accept: boolean) {
    setActionLoading(inviteId);
    setError(null);
    try {
      await api.respondToInvite(inviteId, accept);
      removeInvite(inviteId);
      setInvites((p) => p.filter((i) => i.id !== inviteId));
      if (accept) {
        const channels = await api.fetchMyChannels();
        const inv = invites.find((i) => i.id === inviteId);
        const joined = channels.find((c) => c.id === inv?.channel_id);
        if (joined) onChannelJoined(joined);
      }
    } catch (e) { setError(String(e)); }
    finally { setActionLoading(null); }
  }

  async function handleFriendResponse(requestId: string, accept: boolean) {
    setActionLoading(requestId);
    setError(null);
    try {
      await api.respondToFriendRequest(requestId, accept);
      removeFriendRequest(requestId);
      setFriendRequests((p) => p.filter((r) => r.id !== requestId));
      if (accept) {
        const friends = await api.fetchFriends();
        for (const f of friends) addFriend(f);
      }
    } catch (e) { setError(String(e)); }
    finally { setActionLoading(null); }
  }

  async function handleJoinRequestResponse(requestId: string, approve: boolean) {
    setActionLoading(requestId);
    setError(null);
    try {
      await api.respondToJoinRequest(requestId, approve);
      setAdminJoinRequests((p) => p.filter((r) => r.id !== requestId));
    } catch (e) { setError(String(e)); }
    finally { setActionLoading(null); }
  }

  async function handleSendFriendRequest(userId: string, username: string) {
    setActionLoading(userId);
    setError(null);
    try {
      await api.sendFriendRequest(username);
      setSentRequests((p) => new Set(p).add(userId));
    } catch (e) { setError(String(e)); }
    finally { setActionLoading(null); }
  }

  const totalPending = invites.length + friendRequests.length + adminJoinRequests.length;

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'channels', label: 'Discover' },
    { id: 'requests', label: 'Requests', badge: totalPending > 0 && tab !== 'requests' ? totalPending : undefined },
    { id: 'search', label: 'Find People' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#2b2d31] rounded-2xl w-[580px] max-h-[82vh] flex flex-col shadow-2xl border border-white/5 overflow-hidden">

        {/* Header with gradient */}
        <div className="relative px-6 pt-5 pb-4 bg-linear-to-r from-[#5865f2]/15 via-transparent to-[#7289da]/10">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-white font-bold text-xl tracking-tight">Discover</h2>
              <p className="text-[#80848e] text-xs mt-0.5">Find channels, people, and manage requests</p>
            </div>
            <button
              onClick={onClose}
              className="text-[#80848e] hover:text-white hover:bg-white/10 w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-150"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative px-4 py-1.5 rounded-xl text-sm font-semibold transition-all duration-150 ${
                  tab === t.id
                    ? 'bg-[#5865f2] text-white shadow-lg shadow-[#5865f2]/30'
                    : 'text-[#80848e] hover:text-white hover:bg-white/5'
                }`}
              >
                {t.label}
                {t.badge && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-[#ed4245] rounded-full text-white text-[10px] flex items-center justify-center font-bold">
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mt-3 px-4 py-2 bg-[#ed4245]/15 border border-[#ed4245]/30 text-[#ed4245] rounded-xl text-sm">
            {error}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">

          {/* ── Channels ─────────────────────────────────────────────── */}
          {tab === 'channels' && (
            <>
              <div className="relative mb-3">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4e5058] w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                </svg>
                <input
                  value={channelQuery}
                  onChange={(e) => setChannelQuery(e.target.value)}
                  placeholder="Search channels…"
                  className="w-full pl-9 pr-4 py-2.5 bg-[#1e1f22] text-white rounded-xl text-sm outline-none placeholder-[#4e5058] border border-transparent focus:border-[#5865f2]/50 transition-colors"
                />
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-10 text-[#4e5058]">
                  <svg className="animate-spin w-5 h-5 mr-2" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Loading…
                </div>
              ) : allChannels.length === 0 ? (
                <p className="text-center text-[#4e5058] text-sm py-10">No channels found</p>
              ) : (
                allChannels.map((ch) => {
                  const isMember = !!ch.my_role;
                  const isPending = sentRequests.has(ch.id);
                  const busy = actionLoading === ch.id;
                  return (
                    <div
                      key={ch.id}
                      className="group flex items-center justify-between px-4 py-3 bg-[#313338] hover:bg-[#383a40] rounded-xl border border-transparent hover:border-[#404249] transition-all duration-150"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm ${
                          isMember ? 'bg-linear-to-br from-[#5865f2] to-[#7289da] text-white' : 'bg-[#383a40] text-[#4e5058]'
                        }`}>
                          {ch.is_public ? '#' : '🔒'}
                        </div>
                        <div className="min-w-0">
                          <p className="text-white text-sm font-semibold truncate">{ch.name}</p>
                          {ch.description && (
                            <p className="text-[#80848e] text-xs truncate">{ch.description}</p>
                          )}
                          <div className="flex items-center gap-1 mt-0.5">
                            <svg className="w-3 h-3 text-[#4e5058]" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                            </svg>
                            <span className="text-[#4e5058] text-[11px]">{ch.member_count}</span>
                            {!ch.is_public && <span className="text-[#4e5058] text-[11px] ml-1">· private</span>}
                          </div>
                        </div>
                      </div>

                      {isMember ? (
                        <span className="shrink-0 px-3 py-1 bg-[#23a559]/15 border border-[#23a559]/30 text-[#23a559] rounded-lg text-xs font-semibold">
                          ✓ Joined
                        </span>
                      ) : isPending ? (
                        <span className="shrink-0 px-3 py-1 bg-[#f0b132]/15 border border-[#f0b132]/30 text-[#f0b132] rounded-lg text-xs font-semibold">
                          ⏳ Pending
                        </span>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => handleJoin(ch.id, isMember)}
                          className="shrink-0 px-4 py-1.5 bg-linear-to-r from-[#5865f2] to-[#7289da] text-white rounded-lg text-xs font-semibold hover:from-[#4752c4] hover:to-[#5865f2] disabled:opacity-50 transition-all duration-150 shadow-md shadow-[#5865f2]/20"
                        >
                          {busy ? '…' : ch.is_public ? '+ Join' : '↗ Request'}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </>
          )}

          {/* ── Requests ─────────────────────────────────────────────── */}
          {tab === 'requests' && (
            <>
              {loading ? (
                <div className="flex items-center justify-center py-10 text-[#4e5058]">
                  <svg className="animate-spin w-5 h-5 mr-2" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Loading…
                </div>
              ) : totalPending === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-[#4e5058]">
                  <span className="text-4xl mb-3">✨</span>
                  <p className="text-sm font-medium">All caught up!</p>
                  <p className="text-xs mt-1">No pending requests</p>
                </div>
              ) : (
                <>
                  {/* Admin: join requests to approve */}
                  {adminJoinRequests.length > 0 && (
                    <section>
                      <p className="text-[#80848e] text-[10px] font-bold uppercase tracking-widest mb-2 px-1">
                        Join Requests — waiting for your approval
                      </p>
                      {adminJoinRequests.map((jr) => (
                        <div key={jr.id} className="flex items-center gap-3 px-4 py-3 bg-[#313338] rounded-xl mb-1.5 border border-[#404249]/50">
                          <div className="w-9 h-9 rounded-full bg-linear-to-br from-[#f0b132] to-[#e67e22] flex items-center justify-center text-sm font-bold text-white shrink-0">
                            {jr.username[0]?.toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-semibold">{jr.username}</p>
                            <p className="text-[#80848e] text-xs">wants to join <span className="text-[#b5bac1] font-medium">#{jr.channel_name}</span></p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button
                              disabled={actionLoading === jr.id}
                              onClick={() => handleJoinRequestResponse(jr.id, true)}
                              className="px-3 py-1.5 bg-[#23a559] text-white rounded-lg text-xs font-semibold hover:bg-[#1e8c4a] disabled:opacity-50 transition-colors"
                            >
                              ✓
                            </button>
                            <button
                              disabled={actionLoading === jr.id}
                              onClick={() => handleJoinRequestResponse(jr.id, false)}
                              className="px-3 py-1.5 bg-[#ed4245] text-white rounded-lg text-xs font-semibold hover:bg-[#c53537] disabled:opacity-50 transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </section>
                  )}

                  {/* Channel invites */}
                  {invites.length > 0 && (
                    <section className={adminJoinRequests.length > 0 ? 'mt-4' : ''}>
                      <p className="text-[#80848e] text-[10px] font-bold uppercase tracking-widest mb-2 px-1">
                        Channel Invites
                      </p>
                      {invites.map((inv) => (
                        <div key={inv.id} className="flex items-center gap-3 px-4 py-3 bg-[#313338] rounded-xl mb-1.5 border border-[#5865f2]/20">
                          <div className="w-9 h-9 rounded-xl bg-linear-to-br from-[#5865f2] to-[#7289da] flex items-center justify-center text-sm font-bold text-white shrink-0">
                            #
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-semibold">#{inv.channel_name}</p>
                            <p className="text-[#80848e] text-xs">invited by <span className="text-[#b5bac1]">{inv.inviter_username}</span></p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button
                              disabled={actionLoading === inv.id}
                              onClick={() => handleInviteResponse(inv.id, true)}
                              className="px-3 py-1.5 bg-[#23a559] text-white rounded-lg text-xs font-semibold hover:bg-[#1e8c4a] disabled:opacity-50 transition-colors"
                            >
                              Accept
                            </button>
                            <button
                              disabled={actionLoading === inv.id}
                              onClick={() => handleInviteResponse(inv.id, false)}
                              className="px-3 py-1.5 bg-[#383a40] text-[#80848e] rounded-lg text-xs font-semibold hover:text-white hover:bg-[#ed4245] disabled:opacity-50 transition-all"
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      ))}
                    </section>
                  )}

                  {/* Friend requests */}
                  {friendRequests.length > 0 && (
                    <section className={(adminJoinRequests.length > 0 || invites.length > 0) ? 'mt-4' : ''}>
                      <p className="text-[#80848e] text-[10px] font-bold uppercase tracking-widest mb-2 px-1">
                        Friend Requests
                      </p>
                      {friendRequests.map((fr) => (
                        <div key={fr.id} className="flex items-center gap-3 px-4 py-3 bg-[#313338] rounded-xl mb-1.5 border border-[#23a559]/20">
                          <div className="w-9 h-9 rounded-full bg-linear-to-br from-[#23a559] to-[#1e8c4a] flex items-center justify-center text-sm font-bold text-white shrink-0">
                            {fr.sender_username?.[0]?.toUpperCase() ?? '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-semibold">{fr.sender_username}</p>
                            <p className="text-[#80848e] text-xs">wants to be friends</p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button
                              disabled={actionLoading === fr.id}
                              onClick={() => handleFriendResponse(fr.id, true)}
                              className="px-3 py-1.5 bg-[#23a559] text-white rounded-lg text-xs font-semibold hover:bg-[#1e8c4a] disabled:opacity-50 transition-colors"
                            >
                              Accept
                            </button>
                            <button
                              disabled={actionLoading === fr.id}
                              onClick={() => handleFriendResponse(fr.id, false)}
                              className="px-3 py-1.5 bg-[#383a40] text-[#80848e] rounded-lg text-xs font-semibold hover:text-white hover:bg-[#ed4245] disabled:opacity-50 transition-all"
                            >
                              Ignore
                            </button>
                          </div>
                        </div>
                      ))}
                    </section>
                  )}
                </>
              )}
            </>
          )}

          {/* ── Search ───────────────────────────────────────────────── */}
          {tab === 'search' && (
            <>
              <div className="relative mb-3">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4e5058] w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                </svg>
                <input
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder="Search by username…"
                  className="w-full pl-9 pr-4 py-2.5 bg-[#1e1f22] text-white rounded-xl text-sm outline-none placeholder-[#4e5058] border border-transparent focus:border-[#5865f2]/50 transition-colors"
                  autoFocus
                />
              </div>

              {userQuery.trim().length > 0 && userQuery.trim().length < 2 && (
                <p className="text-[#4e5058] text-xs px-1">Type at least 2 characters…</p>
              )}

              {searchResults.length === 0 && userQuery.trim().length >= 2 ? (
                <div className="flex flex-col items-center justify-center py-10 text-[#4e5058]">
                  <span className="text-3xl mb-2">🔍</span>
                  <p className="text-sm">No users found for &ldquo;{userQuery}&rdquo;</p>
                </div>
              ) : (
                searchResults.map((u) => {
                  const alreadyFriend = isFriend(u.id);
                  const sent = sentRequests.has(u.id);
                  const busy = actionLoading === u.id;
                  return (
                    <div
                      key={u.id}
                      className="flex items-center gap-3 px-4 py-3 bg-[#313338] hover:bg-[#383a40] rounded-xl border border-transparent hover:border-[#404249] transition-all duration-150"
                    >
                      <div className="w-10 h-10 rounded-full bg-linear-to-br from-[#5865f2] to-[#7289da] flex items-center justify-center text-sm font-bold text-white shrink-0 shadow-md">
                        {u.username[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-semibold">{u.username}</p>
                        <p className="text-[#4e5058] text-xs">{alreadyFriend ? 'Already friends ✓' : 'Click to add as friend'}</p>
                      </div>
                      {alreadyFriend ? (
                        <span className="shrink-0 px-3 py-1.5 bg-[#23a559]/15 border border-[#23a559]/30 text-[#23a559] rounded-lg text-xs font-semibold">
                          Friends
                        </span>
                      ) : sent ? (
                        <span className="shrink-0 px-3 py-1.5 bg-[#5865f2]/15 border border-[#5865f2]/30 text-[#7289da] rounded-lg text-xs font-semibold">
                          ✓ Sent
                        </span>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => handleSendFriendRequest(u.id, u.username)}
                          className="shrink-0 px-4 py-1.5 bg-linear-to-r from-[#5865f2] to-[#7289da] text-white rounded-lg text-xs font-semibold hover:from-[#4752c4] hover:to-[#5865f2] disabled:opacity-50 transition-all shadow-md shadow-[#5865f2]/20"
                        >
                          {busy ? '…' : '+ Add'}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
