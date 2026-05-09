/**
 * ChatWindow — Native-scroll message list with Discord-style polish.
 *
 * Responsibilities:
 *   - Render messages grouped by author within a 5-minute window (compact rows
 *     that share the same avatar/header).
 *   - Insert date separators between days ("Today", "Yesterday", or full date).
 *   - Auto-scroll to the bottom on new messages when the user is already at
 *     the bottom; otherwise show a "jump to present" pill.
 *   - Cursor-paginate older history (`before_id`) when scrolling near the top,
 *     preserving the user's visual scroll position across the prepend.
 *   - Surface per-row hover actions (copy text).
 */
'use client';

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { ApiClient } from '@dis/api';
import { useDisStore } from '@dis/store';
import type { Message } from '@dis/types';
import { Avatar } from '@/components/ui/Avatar';
import { Spinner } from '@/components/ui/Spinner';
import {
  dayKey,
  formatDateSeparator,
  formatMessageTimestamp,
  formatTime,
  minutesBetween,
} from '@/lib/format';
import { toast } from '@/lib/toast';

const PAGE_SIZE = 50;
const GROUP_WINDOW_MIN = 5;
const NEAR_TOP_PX = 100;
const NEAR_BOTTOM_PX = 80;

interface Props {
  channelId: string;
  api: ApiClient;
  /** True when the active user is allowed to read this channel. */
  isMember: boolean;
}

type Row =
  | { kind: 'separator'; key: string; iso: string }
  | { kind: 'message'; key: string; msg: Message; compact: boolean };

function buildRows(messages: Message[]): Row[] {
  const out: Row[] = [];
  let prevAuthor: string | null = null;
  let prevIso: string | null = null;
  let prevDay: string | null = null;
  for (const msg of messages) {
    const day = dayKey(msg.created_at);
    if (day !== prevDay) {
      out.push({ kind: 'separator', key: `sep-${day}`, iso: msg.created_at });
      prevAuthor = null;
      prevIso = null;
    }
    const compact =
      prevAuthor === msg.user_id &&
      prevIso !== null &&
      minutesBetween(prevIso, msg.created_at) < GROUP_WINDOW_MIN;
    out.push({ kind: 'message', key: msg.id, msg, compact });
    prevAuthor = msg.user_id;
    prevIso = msg.created_at;
    prevDay = day;
  }
  return out;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

const DateSeparator = memo(function DateSeparator({ iso }: { iso: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 select-none">
      <div className="flex-1 h-px bg-[#3f4147]" />
      <span className="text-[11px] font-semibold text-[#b5bac1] tracking-wide">
        {formatDateSeparator(iso)}
      </span>
      <div className="flex-1 h-px bg-[#3f4147]" />
    </div>
  );
});

const MessageRow = memo(function MessageRow({
  msg,
  compact,
}: {
  msg: Message;
  compact: boolean;
}) {
  const handleCopy = () => {
    navigator.clipboard
      .writeText(msg.content)
      .then(() => toast.success('Message copied'))
      .catch(() => toast.error('Failed to copy'));
  };

  return (
    <div
      className={`group relative flex gap-4 px-4 hover:bg-[#2e3035] transition-colors ${
        compact ? 'py-0.5 mt-px' : 'pt-3 pb-1 mt-2'
      } ${msg.pending ? 'opacity-60' : ''}`}
    >
      <div className="w-10 shrink-0 flex justify-center">
        {compact ? (
          <span className="opacity-0 group-hover:opacity-100 text-[10px] text-[#80848e] tabular-nums leading-loose select-none">
            {formatTime(new Date(msg.created_at))}
          </span>
        ) : (
          <Avatar name={msg.username} size={40} ringClass="ring-[#313338]" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        {!compact && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-white font-semibold text-[15px] leading-none">
              {msg.username}
            </span>
            <span
              className="text-[11px] text-[#949ba4] cursor-default"
              title={new Date(msg.created_at).toLocaleString()}
            >
              {formatMessageTimestamp(msg.created_at)}
            </span>
            {msg.pending && (
              <span className="text-[11px] text-[#949ba4] italic">sending…</span>
            )}
          </div>
        )}
        <p className="text-[#dbdee1] text-[15px] leading-[1.375] break-words whitespace-pre-wrap">
          {msg.content}
        </p>
      </div>

      {/* Hover toolbar */}
      <div className="absolute top-0 right-4 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="bg-[#2b2d31] border border-black/40 rounded-md shadow-md flex items-center">
          <button
            onClick={handleCopy}
            title="Copy text"
            className="p-1.5 text-[#b5bac1] hover:text-white hover:bg-white/5 rounded"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 1H4a2 2 0 00-2 2v14h2V3h12V1zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11v14z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
});

const TypingPlaceholder = memo(function TypingPlaceholder() {
  return null; // backend doesn't expose typing — reserved for future use
});

// ─── ChatWindow ────────────────────────────────────────────────────────────────

const ChatWindow = memo(function ChatWindow({ channelId, api, isMember }: Props) {
  const messages = useDisStore((s) => s.messages[channelId] ?? []);
  const setMessages = useDisStore((s) => s.setMessages);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const lastChannelRef = useRef<string | null>(null);
  const prependAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

  // Per-channel pagination state. Keyed by channelId so a re-mount of the
  // component for a new channel doesn't carry stale state.
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [showJump, setShowJump] = useState(false);

  // Reset pagination state when the channel changes
  useEffect(() => {
    if (lastChannelRef.current !== channelId) {
      lastChannelRef.current = channelId;
      setHasMore(true);
      setLoadingMore(false);
      setInitialLoading(true);
      atBottomRef.current = true;
      setShowJump(false);
    }
  }, [channelId]);

  // Initial fetch — done by the parent already, but we still want a "loading"
  // skeleton when the store is empty for this channel.
  useEffect(() => {
    if (!isMember) {
      setInitialLoading(false);
      return;
    }
    if (messages.length > 0) {
      setInitialLoading(false);
      // If the page already fetched fewer than PAGE_SIZE, there's no more.
      if (messages.length < PAGE_SIZE) setHasMore(false);
      return;
    }
    let cancelled = false;
    setInitialLoading(true);
    api
      .fetchMessages(channelId, PAGE_SIZE)
      .then((msgs) => {
        if (cancelled) return;
        setMessages(channelId, msgs);
        if (msgs.length < PAGE_SIZE) setHasMore(false);
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : 'Failed to load messages');
      })
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, isMember]);

  const loadOlder = useCallback(async () => {
    if (!hasMore || loadingMore || messages.length === 0) return;
    const oldest = messages[0]!;
    setLoadingMore(true);
    const el = scrollerRef.current;
    if (el) {
      prependAnchorRef.current = {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
      };
    }
    try {
      const older = await api.fetchMessages(channelId, PAGE_SIZE, oldest.id);
      if (older.length === 0) {
        setHasMore(false);
      } else {
        // Merge older into the existing list. setMessages already de-dupes.
        setMessages(channelId, [...older, ...messages]);
        if (older.length < PAGE_SIZE) setHasMore(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load older messages');
      prependAnchorRef.current = null;
    } finally {
      setLoadingMore(false);
    }
  }, [api, channelId, hasMore, loadingMore, messages, setMessages]);

  // Restore scroll position after a prepend so the user's visual context is
  // preserved (their previously-visible message stays under the cursor).
  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const el = scrollerRef.current;
    if (anchor && el) {
      const newScrollTop = el.scrollHeight - anchor.scrollHeight + anchor.scrollTop;
      el.scrollTop = newScrollTop;
      prependAnchorRef.current = null;
    }
  }, [messages]);

  // Auto-scroll to bottom on new messages when the user is at the bottom.
  useLayoutEffect(() => {
    if (atBottomRef.current && scrollerRef.current && messages.length > 0) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages.length]);

  // First-render scroll-to-bottom for this channel
  useLayoutEffect(() => {
    if (!initialLoading && scrollerRef.current && messages.length > 0) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoading, channelId]);

  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = distFromBottom < NEAR_BOTTOM_PX;
    setShowJump(distFromBottom > 240 && messages.length > 0);
    if (el.scrollTop < NEAR_TOP_PX && hasMore && !loadingMore && !initialLoading) {
      loadOlder();
    }
  };

  const jumpToPresent = () => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setShowJump(false);
  };

  // ─── Render branches ────────────────────────────────────────────────────────

  if (!isMember) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-[#80848e] gap-2 px-6 text-center">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" className="opacity-25">
          <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
        </svg>
        <p className="text-sm font-medium">You&apos;re previewing this channel</p>
        <p className="text-xs">Join to see messages and start chatting.</p>
      </div>
    );
  }

  if (initialLoading) {
    return <ChatLoadingSkeleton />;
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-[#80848e] gap-2 px-6 text-center">
        <span className="text-5xl">💬</span>
        <p className="text-base font-semibold text-white">No messages yet</p>
        <p className="text-xs">Be the first to say something.</p>
      </div>
    );
  }

  const rows = buildRows(messages);

  return (
    <div className="flex-1 relative min-h-0">
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="absolute inset-0 overflow-y-auto overflow-x-hidden pb-4 pt-4"
      >
        {/* Top loading indicator / end-of-history banner */}
        <div className="px-4 pb-2 pt-1 flex items-center justify-center text-[#80848e] text-xs">
          {loadingMore ? (
            <span className="flex items-center gap-2">
              <Spinner size={14} />
              Loading older messages…
            </span>
          ) : !hasMore ? (
            <span className="text-[#4e5058]">— Beginning of channel —</span>
          ) : null}
        </div>

        {rows.map((row) =>
          row.kind === 'separator' ? (
            <DateSeparator key={row.key} iso={row.iso} />
          ) : (
            <MessageRow key={row.key} msg={row.msg} compact={row.compact} />
          )
        )}

        <TypingPlaceholder />
      </div>

      {showJump && (
        <button
          onClick={jumpToPresent}
          className="absolute bottom-3 right-4 bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg shadow-black/40 flex items-center gap-1.5 animate-[fadeIn_140ms_ease-out]"
        >
          Jump to present
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 16l-6-6h12z" />
          </svg>
        </button>
      )}
    </div>
  );
});

export default ChatWindow;

// ─── Loading skeleton ──────────────────────────────────────────────────────────

function ChatLoadingSkeleton() {
  return (
    <div className="flex-1 px-4 py-6 space-y-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-4 animate-pulse">
          <div className="w-10 h-10 rounded-full bg-[#3a3c43] shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="flex gap-2 items-center">
              <div className="h-3 w-24 bg-[#3a3c43] rounded" />
              <div className="h-2.5 w-16 bg-[#2e3035] rounded" />
            </div>
            <div className="h-3 w-3/4 bg-[#3a3c43] rounded" />
            {i % 2 === 0 && <div className="h-3 w-1/2 bg-[#2e3035] rounded" />}
          </div>
        </div>
      ))}
    </div>
  );
}
