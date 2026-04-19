'use client';

import { memo } from 'react';
import { useDisStore } from '@dis/store';
import type { ChannelSummary } from '@dis/types';

interface Props {
  onDiscover: () => void;
  onCreateChannel: () => void;
}

// ── ChannelItem ────────────────────────────────────────────────────────────────
// Module-level component so React can memoize it per-item and assign stable
// hook slots.  Each item subscribes only to its own slice of `unread` and to
// whether IT is the active channel — not to the full `unread` map.
// Before this refactoring, a NEW_MESSAGE event for ANY channel triggered a
// full ChannelList re-render (because the `unread` object reference changed).
// Now only the specific item whose badge changes re-renders.

const ChannelItem = memo(function ChannelItem({
  ch,
  label,
  icon,
  dim = false,
}: {
  ch: ChannelSummary;
  label: string;
  icon: string;
  dim?: boolean;
}) {
  const active = useDisStore((s) => s.activeChannelId === ch.id);
  const unreadCount = useDisStore((s) => s.unread[ch.id] ?? 0);
  const setActiveChannel = useDisStore((s) => s.setActiveChannel);
  const hasUnread = unreadCount > 0 && !active;

  return (
    <li>
      <button
        onClick={() => setActiveChannel(ch.id)}
        className={`group w-full text-left px-2 py-1 rounded-lg text-sm transition-all duration-150 flex items-center gap-2.5 ${
          active
            ? 'bg-[#404249] text-white'
            : hasUnread
            ? 'text-white hover:bg-[#35373c]'
            : dim
            ? 'text-[#4e5058] hover:bg-[#35373c] hover:text-[#80848e]'
            : 'text-[#80848e] hover:bg-[#35373c] hover:text-[#dbdee1]'
        }`}
      >
        {/* Active indicator */}
        <span
          className={`absolute left-0 w-1 h-5 rounded-r-full bg-white transition-all duration-150 ${
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-30'
          }`}
          style={{ position: 'absolute', left: 0 }}
        />

        {ch.is_direct ? (
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
              active
                ? 'bg-[#5865f2] text-white'
                : 'bg-[#36373d] text-[#80848e] group-hover:bg-[#5865f2]/20 group-hover:text-[#7289da]'
            } transition-colors duration-150`}
          >
            {(label[0] ?? '?').toUpperCase()}
          </div>
        ) : (
          <span
            className={`text-base leading-none transition-colors duration-150 ${
              active ? 'text-white' : dim ? 'text-[#4e5058]' : 'text-[#80848e] group-hover:text-[#dbdee1]'
            }`}
          >
            {icon}
          </span>
        )}

        <span className="truncate flex-1 font-medium">{label}</span>

        {/* Unread badge takes priority over lock icon */}
        {hasUnread ? (
          <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1 bg-[#ed4245] rounded-full text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : dim ? (
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="shrink-0 opacity-40"
          >
            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
          </svg>
        ) : null}
      </button>
    </li>
  );
});

function SectionLabel({ label }: { label: string }) {
  return (
    <li className="px-2 pt-4 pb-1">
      <span className="text-[#4e5058] text-[10px] font-bold uppercase tracking-widest">
        {label}
      </span>
    </li>
  );
}

// ── ChannelList ────────────────────────────────────────────────────────────────
// No longer subscribes to `unread` or `activeChannelId` — those are consumed
// only inside ChannelItem, which re-renders independently per channel.

const ChannelList = memo(function ChannelList({ onDiscover, onCreateChannel }: Props) {
  const channels = useDisStore((s) => s.channels);
  const dms = useDisStore((s) => s.dms);
  const friends = useDisStore((s) => s.friends);
  const user = useDisStore((s) => s.user);
  const wsStatus = useDisStore((s) => s.wsStatus);
  const clearAuth = useDisStore((s) => s.clearAuth);
  const socialBadge = useDisStore((s) => s.socialBadge);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    clearAuth();
    window.location.href = '/login';
  };

  function dmLabel(dm: ChannelSummary): string {
    const friend = friends.find((f) => f.dm_channel_id === dm.id);
    return friend ? friend.username : dm.name;
  }

  const joinedChannels = channels.filter((c) => !c.is_direct && !!c.my_role);
  const browsableChannels = channels.filter((c) => !c.is_direct && !c.my_role);

  return (
    <aside className="w-60 shrink-0 bg-[#2b2d31] flex flex-col relative overflow-hidden">
      {/* Decorative gradient top */}
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#5865f2]/8 to-transparent pointer-events-none" />

      {/* Header */}
      <div className="relative px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#5865f2] to-[#7289da] flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
            </svg>
          </div>
          <span className="font-bold text-white text-sm tracking-tight">Channels</span>
        </div>
        <span
          className={`flex items-center gap-1 text-[10px] font-medium ${
            wsStatus === 'connected'
              ? 'text-[#23a559]'
              : wsStatus === 'reconnecting'
              ? 'text-yellow-400'
              : 'text-[#80848e]'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              wsStatus === 'connected'
                ? 'bg-[#23a559] shadow-[0_0_6px_#23a559]'
                : wsStatus === 'reconnecting'
                ? 'bg-yellow-400 animate-pulse'
                : 'bg-[#80848e]'
            }`}
          />
          {wsStatus}
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex gap-1.5 px-2.5 pt-2.5">
        <button
          onClick={onCreateChannel}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-[#80848e] hover:bg-[#35373c] hover:text-white transition-all duration-150 border border-transparent hover:border-[#404249]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 11H13V5a1 1 0 0 0-2 0v6H5a1 1 0 0 0 0 2h6v6a1 1 0 0 0 2 0v-6h6a1 1 0 0 0 0-2z" />
          </svg>
          New
        </button>
        <button
          onClick={onDiscover}
          className="flex-1 relative flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold text-[#80848e] hover:bg-[#35373c] hover:text-white transition-all duration-150 border border-transparent hover:border-[#404249]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          Discover
          {socialBadge > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-[#ed4245] rounded-full text-white text-[10px] flex items-center justify-center font-bold shadow-lg">
              {socialBadge > 9 ? '9+' : socialBadge}
            </span>
          )}
        </button>
      </div>

      {/* Channel lists */}
      <ul className="flex-1 overflow-y-auto py-1 px-1.5 space-y-0.5 relative">
        {joinedChannels.length > 0 && (
          <>
            <SectionLabel label="Channels" />
            {joinedChannels.map((ch) => (
              <ChannelItem key={ch.id} ch={ch} icon="#" label={ch.name} />
            ))}
          </>
        )}

        {browsableChannels.length > 0 && (
          <>
            <SectionLabel label="Public" />
            {browsableChannels.map((ch) => (
              <ChannelItem key={ch.id} ch={ch} icon="#" dim label={ch.name} />
            ))}
          </>
        )}

        {joinedChannels.length === 0 && browsableChannels.length === 0 && dms.length === 0 && (
          <li className="px-3 py-6 text-center">
            <p className="text-[#4e5058] text-xs">No channels yet</p>
            <button
              onClick={onCreateChannel}
              className="mt-2 text-[#5865f2] text-xs hover:underline"
            >
              Create one →
            </button>
          </li>
        )}

        {dms.length > 0 && (
          <>
            <SectionLabel label="Direct Messages" />
            {dms.map((dm) => (
              <ChannelItem key={dm.id} ch={dm} icon="@" label={dmLabel(dm)} />
            ))}
          </>
        )}
      </ul>

      {/* User bar */}
      {user && (
        <div className="px-3 py-2.5 bg-[#232428] border-t border-white/5 flex items-center gap-2.5">
          <div className="relative shrink-0">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#5865f2] to-[#7289da] flex items-center justify-center text-xs font-bold text-white select-none shadow-md">
              {user.username[0]?.toUpperCase()}
            </div>
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#23a559] rounded-full border-2 border-[#232428]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-semibold truncate leading-none">{user.username}</p>
            <p className="text-[10px] text-[#4e5058] mt-0.5">online</p>
          </div>
          <button
            onClick={handleLogout}
            title="Log out"
            className="text-[#4e5058] hover:text-[#ed4245] transition-colors duration-150"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
            </svg>
          </button>
        </div>
      )}
    </aside>
  );
});

export default ChannelList;
