'use client';

import { memo, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDisStore } from '@dis/store';
import type { Message } from '@dis/types';

// ─── Single message row ───────────────────────────────────────────────────────

const MessageRow = memo(function MessageRow({ msg }: { msg: Message }) {
  const isToday = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return isToday(dateStr)
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
          ' ' +
          d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      className={`flex gap-3 px-4 py-1.5 hover:bg-white/[0.04] transition-colors ${
        msg.pending ? 'opacity-50' : ''
      }`}
    >
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-[#5865f2] flex items-center justify-center text-sm font-bold text-white shrink-0 mt-0.5 select-none">
        {msg.username[0]?.toUpperCase()}
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-white text-sm leading-none">
            {msg.username}
          </span>
          <span className="text-[11px] text-[#949ba4]">{formatTime(msg.created_at)}</span>
          {msg.pending && (
            <span className="text-[11px] text-[#949ba4] italic">sending…</span>
          )}
        </div>
        <p className="text-[#dbdee1] text-sm mt-0.5 break-words leading-relaxed">
          {msg.content}
        </p>
      </div>
    </div>
  );
});

// ─── Chat window (virtualised) ────────────────────────────────────────────────

interface Props {
  channelId: string;
}

const ChatWindow = memo(function ChatWindow({ channelId }: Props) {
  const messages = useDisStore((s) => s.messages[channelId] ?? []);
  const parentRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 8,
  });

  // Auto-scroll to bottom when new messages arrive (only if already at bottom)
  useEffect(() => {
    if (atBottomRef.current && messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    }
  }, [messages.length, virtualizer]);

  const handleScroll = () => {
    const el = parentRef.current;
    if (!el) return;
    atBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto"
    >
      {messages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center h-full text-[#949ba4] text-sm">
          No messages yet. Say hello!
        </div>
      ) : (
        <div
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        >
          {items.map((item) => (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
              }}
            >
              <MessageRow msg={messages[item.index]} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default ChatWindow;
