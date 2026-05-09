/**
 * MessageInput — Chat text input with send button.
 *
 * Features:
 * - 2000-char limit with live counter when near the limit
 * - Shows a "Join" button for non-members (uses onJoin prop)
 * - Resolves placeholder to "#channel" or "@username" for DMs
 * - Enter to send, Shift+Enter for newline
 */
'use client';

import { memo, useState, type KeyboardEvent } from 'react';
import { useDisStore } from '@dis/store';

interface Props {
  onSend: (content: string) => void;
  onJoin?: () => void;
  joinPending?: boolean;
}

const MAX_LENGTH = 2000;

const MessageInput = memo(function MessageInput({ onSend, onJoin, joinPending }: Props) {
  const [value, setValue] = useState('');
  const channels = useDisStore((s) => s.channels);
  const dms = useDisStore((s) => s.dms);
  const friends = useDisStore((s) => s.friends);
  const activeChannelId = useDisStore((s) => s.activeChannelId);
  const activeChannel =
    channels.find((c) => c.id === activeChannelId) ??
    dms.find((c) => c.id === activeChannelId);

  // DMs are always joined; regular channels need my_role set
  const isMember = !!activeChannel?.my_role || !!activeChannel?.is_direct;
  const canSend = isMember && value.trim().length > 0 && value.trim().length <= MAX_LENGTH;

  // Resolve a human-readable label for the active channel
  const channelLabel = (() => {
    if (!activeChannel) return '';
    if (activeChannel.is_direct) {
      const friend = friends.find((f) => f.dm_channel_id === activeChannel.id);
      return friend ? `@${friend.username}` : '@dm';
    }
    return `#${activeChannel.name}`;
  })();

  const submit = () => {
    if (!canSend) return;
    onSend(value.trim());
    setValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Not a member → join prompt
  if (activeChannel && !isMember) {
    return (
      <div className="px-4 pb-4 pt-1 shrink-0">
        <div className="bg-linear-to-r from-[#2b2d31] to-[#313338] border border-[#404249] rounded-2xl flex items-center justify-between px-5 py-3.5 gap-4">
          <div className="min-w-0">
            <p className="text-[#b5bac1] text-sm">
              <span className="text-white font-semibold">{channelLabel}</span>
              {activeChannel.is_public
                ? ' is a public channel — join to start chatting'
                : ' is private — send a join request to the admin'}
            </p>
          </div>
          {joinPending ? (
            <span className="shrink-0 px-4 py-2 bg-[#1e3a2f] border border-[#23a559]/40 text-[#23a559] text-sm font-semibold rounded-xl">
              ✓ Request Sent
            </span>
          ) : (
            <button
              onClick={onJoin}
              className="shrink-0 px-4 py-2 bg-linear-to-r from-[#5865f2] to-[#7289da] text-white text-sm font-semibold rounded-xl hover:from-[#4752c4] hover:to-[#5865f2] transition-all duration-200 shadow-lg shadow-[#5865f2]/25"
            >
              {activeChannel.is_public ? '+ Join' : '↗ Request to Join'}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 pt-1 shrink-0">
      <div className="bg-[#383a40] rounded-2xl border border-[#404249]/50 focus-within:border-[#5865f2]/50 transition-colors duration-200">
        <div className="flex items-end gap-2 px-4 py-3">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${channelLabel}`}
            rows={1}
            maxLength={MAX_LENGTH + 10}
            className="flex-1 bg-transparent text-[#dbdee1] placeholder-[#4e5058] resize-none focus:outline-none text-sm leading-6 max-h-36 overflow-y-auto"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />

          {value.length > MAX_LENGTH - 100 && (
            <span
              className={`text-xs shrink-0 mb-1 tabular-nums ${
                value.length > MAX_LENGTH ? 'text-red-400' : 'text-yellow-400'
              }`}
            >
              {MAX_LENGTH - value.length}
            </span>
          )}

          <button
            onClick={submit}
            disabled={!canSend}
            title="Send (Enter)"
            className={`shrink-0 mb-0.5 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 ${
              canSend
                ? 'bg-[#5865f2] text-white hover:bg-[#4752c4] shadow-md shadow-[#5865f2]/30'
                : 'text-[#4e5058] cursor-not-allowed'
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>
      <p className="text-[10px] text-[#4e5058] mt-1 pl-1">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
});

export default MessageInput;
