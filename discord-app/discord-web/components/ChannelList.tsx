/**
 * ChannelList — Sidebar showing joined channels, public channels, DMs, and the
 * user identity bar at the bottom.
 *
 * Performance: Each ChannelItem subscribes only to its own slice of state
 * (its unread count + whether IT is active) so a new message in one channel
 * does not re-render the entire list.
 */
'use client';

import { memo } from 'react';
import { useDisStore } from '@dis/store';
import type { ChannelSummary } from '@dis/types';
import { Avatar } from '@/components/ui/Avatar';

interface Props {
  onDiscover: () => void;
  onCreateChannel: () => void;
  onPickChannel?: () => void;
}

const ChannelItem = memo(function ChannelItem({
  ch,
  label,
  icon,
  dim = false,
  onPick,
}: {
  ch: ChannelSummary;
  label: string;
  icon: 'hash' | 'lock' | 'at';
  dim?: boolean;
  onPick?: () => void;
}) {
  const active = useDisStore((s) => s.activeChannelId === ch.id);
  const unreadCount = useDisStore((s) => s.unread[ch.id] ?? 0);
  const setActiveChannel = useDisStore((s) => s.setActiveChannel);
  const hasUnread = unreadCount > 0 && !active;

  const handleClick = () => {
    setActiveChannel(ch.id);
    onPick?.();
  };

  return (
    <li>
      <button
        onClick={handleClick}
        className={`group relative w-full text-left pl-3 pr-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${
          active
            ? 'bg-[#404249] text-white'
            : hasUnread
            ? 'text-white hover:bg-[#35373c]'
            : dim
            ? 'text-[#4e5058] hover:bg-[#35373c] hover:text-[#80848e]'
            : 'text-[#80848e] hover:bg-[#35373c] hover:text-[#dbdee1]'
        }`}
      >
        {(active || hasUnread) && (
          <span
            aria-hidden
            className={`absolute -left-1.5 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-white ${
              active ? 'h-5' : 'h-2'
            }`}
          />
        )}

        {ch.is_direct ? (
          <Avatar name={label} size={28} ringClass="ring-[#2b2d31]" />
        ) : icon === 'lock' ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 opacity-70">
            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
          </svg>
        ) : (
          <span className="shrink-0 text-base font-light leading-none w-3.5 text-center">#</span>
        )}

        <span className="truncate flex-1 font-medium">{label}</span>

        {hasUnread && (
          <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1 bg-[#ed4245] rounded-full text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    </li>
  );
});

function SectionLabel({ label }: { label: string }) {
  return (
    <li className="px-2 pt-4 pb-1 select-none">
      <span className="text-[#4e5058] text-[10px] font-bold uppercase tracking-widest">
        {label}
      </span>
    </li>
  );
}

const ChannelList = memo(function ChannelList({
  onDiscover,
  onCreateChannel,
  onPickChannel,
}: Props) {
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
    <aside className="w-60 shrink-0 bg-[#2b2d31] flex flex-col h-full relative overflow-hidden">
      {/* Header */}
      <div className="relative px-3 py-3 border-b border-black/30 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-linear-to-br from-[#5865f2] to-[#7289da] flex items-center justify-center shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
            </svg>
          </div>
          <span className="font-bold text-white text-sm truncate">Dis</span>
        </div>
        <span
          title={`Connection: ${wsStatus}`}
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
                ? 'bg-[#23a559]'
                : wsStatus === 'reconnecting'
                ? 'bg-yellow-400 animate-pulse'
                : 'bg-[#80848e]'
            }`}
          />
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex gap-1.5 px-2 pt-2.5">
        <button
          onClick={onCreateChannel}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold text-[#b5bac1] hover:bg-[#35373c] hover:text-white transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 11H13V5a1 1 0 0 0-2 0v6H5a1 1 0 0 0 0 2h6v6a1 1 0 0 0 2 0v-6h6a1 1 0 0 0 0-2z" />
          </svg>
          New
        </button>
        <button
          onClick={onDiscover}
          className="flex-1 relative flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold text-[#b5bac1] hover:bg-[#35373c] hover:text-white transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          Discover
          {socialBadge > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-[#ed4245] rounded-full text-white text-[10px] flex items-center justify-center font-bold shadow">
              {socialBadge > 9 ? '9+' : socialBadge}
            </span>
          )}
        </button>
      </div>

      {/* Channel lists */}
      <ul className="flex-1 overflow-y-auto pb-2 px-2 space-y-px">
        {joinedChannels.length === 0 && browsableChannels.length === 0 && dms.length === 0 ? (
          <li className="px-3 py-8 text-center">
            <p className="text-[#4e5058] text-xs leading-relaxed">
              You haven&apos;t joined any channels yet.
            </p>
            <button
              onClick={onCreateChannel}
              className="mt-3 inline-block text-[#7289da] text-xs hover:underline font-semibold"
            >
              Create your first channel →
            </button>
          </li>
        ) : (
          <>
            {joinedChannels.length > 0 && (
              <>
                <SectionLabel label="Channels" />
                {joinedChannels.map((ch) => (
                  <ChannelItem
                    key={ch.id}
                    ch={ch}
                    icon={ch.is_public ? 'hash' : 'lock'}
                    label={ch.name}
                    onPick={onPickChannel}
                  />
                ))}
              </>
            )}

            {browsableChannels.length > 0 && (
              <>
                <SectionLabel label="Public" />
                {browsableChannels.map((ch) => (
                  <ChannelItem
                    key={ch.id}
                    ch={ch}
                    icon="hash"
                    dim
                    label={ch.name}
                    onPick={onPickChannel}
                  />
                ))}
              </>
            )}

            {dms.length > 0 && (
              <>
                <SectionLabel label="Direct Messages" />
                {dms.map((dm) => (
                  <ChannelItem
                    key={dm.id}
                    ch={dm}
                    icon="at"
                    label={dmLabel(dm)}
                    onPick={onPickChannel}
                  />
                ))}
              </>
            )}
          </>
        )}
      </ul>

      {/* User bar */}
      {user && (
        <div className="px-2 py-2 bg-[#232428] border-t border-black/30 flex items-center gap-2.5">
          <Avatar name={user.username} size={32} online ringClass="ring-[#232428]" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-semibold truncate leading-tight">
              {user.username}
            </p>
            <p className="text-[10px] text-[#80848e] truncate">online</p>
          </div>
          <button
            onClick={handleLogout}
            title="Log out"
            aria-label="Log out"
            className="shrink-0 p-1.5 text-[#80848e] hover:text-[#ed4245] hover:bg-white/5 rounded transition-colors"
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
