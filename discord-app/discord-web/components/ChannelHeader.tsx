'use client';

import { memo } from 'react';
import { useDisStore } from '@dis/store';
import type { ChannelSummary } from '@dis/types';

interface Props {
  onToggleMembers: () => void;
  showMembers: boolean;
  onOpenSettings: () => void;
  onToggleSidebar?: () => void;
}

const ChannelHeader = memo(function ChannelHeader({
  onToggleMembers,
  showMembers,
  onOpenSettings,
  onToggleSidebar,
}: Props) {
  const activeChannelId = useDisStore((s) => s.activeChannelId);
  const channels = useDisStore((s) => s.channels);
  const dms = useDisStore((s) => s.dms);
  const friends = useDisStore((s) => s.friends);

  if (!activeChannelId) return null;

  const channel: ChannelSummary | undefined =
    channels.find((c) => c.id === activeChannelId) ??
    dms.find((c) => c.id === activeChannelId);
  if (!channel) return null;

  const dmFriend = channel.is_direct
    ? friends.find((f) => f.dm_channel_id === channel.id)
    : undefined;

  const title = channel.is_direct
    ? dmFriend?.username ?? 'Direct Message'
    : channel.name;

  const Prefix = channel.is_direct ? (
    <span className="text-[#80848e] text-base font-light leading-none">@</span>
  ) : channel.is_public ? (
    <span className="text-[#80848e] text-base font-medium leading-none">#</span>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-[#80848e]">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
    </svg>
  );

  return (
    <header className="h-12 shrink-0 flex items-center px-4 gap-3 bg-[#313338] border-b border-black/30 shadow-sm">
      {onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          className="md:hidden text-[#b5bac1] hover:text-white"
          aria-label="Toggle sidebar"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 6h18v2H3zM3 11h18v2H3zM3 16h18v2H3z" />
          </svg>
        </button>
      )}

      <div className="flex items-center gap-2 min-w-0 flex-1">
        {Prefix}
        <h1 className="text-white font-semibold text-[15px] truncate">{title}</h1>
        {channel.description && !channel.is_direct && (
          <>
            <span className="text-[#404249] mx-1 select-none">|</span>
            <p className="text-[#80848e] text-sm truncate">{channel.description}</p>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 text-[#b5bac1]">
        {!channel.is_direct && (
          <button
            onClick={onToggleMembers}
            title={showMembers ? 'Hide members' : 'Show members'}
            aria-pressed={showMembers}
            className={`p-1.5 rounded transition-colors ${
              showMembers ? 'bg-[#404249] text-white' : 'hover:text-white hover:bg-white/5'
            }`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14 13c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4zM6 12a3 3 0 100-6 3 3 0 000 6zm12-3a4 4 0 11-8 0 4 4 0 018 0zm6 11h-4.5v-3c0-1.07-.32-2.05-.85-2.86C20.6 14.45 22 16.5 22 19v3h-2zM18 4a3 3 0 11-1.9 5.32A5 5 0 0019 9a5 5 0 00-1.7-3.76A2.96 2.96 0 0118 4z" />
            </svg>
          </button>
        )}
        {!channel.is_direct && (
          <button
            onClick={onOpenSettings}
            title="Channel settings"
            className="p-1.5 rounded hover:text-white hover:bg-white/5 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94 0 .32.02.64.07.94l-2.03 1.58c-.18.14-.22.4-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6 0-1.98 1.62-3.6 3.6-3.6 1.98 0 3.6 1.62 3.6 3.6 0 1.98-1.62 3.6-3.6 3.6z" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
});

export default ChannelHeader;
