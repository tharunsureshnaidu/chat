/**
 * MembersPanel — Right-side panel listing channel members, grouped by online
 * status (presence polled via /api/presence/:user_id every 30s).
 *
 * Hidden for DMs (no concept of channel membership).
 */
'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { ApiClient } from '@dis/api';
import type { ChannelMember } from '@dis/types';
import { useDisStore } from '@dis/store';
import { Avatar } from '@/components/ui/Avatar';
import { Spinner } from '@/components/ui/Spinner';
import { usePresence } from '@/hooks/usePresence';

interface Props {
  channelId: string;
  api: ApiClient;
  visible: boolean;
}

const MembersPanel = memo(function MembersPanel({ channelId, api, visible }: Props) {
  const me = useDisStore((s) => s.user);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .fetchMembers(channelId)
      .then((m) => {
        if (!cancelled) setMembers(m);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, channelId, visible]);

  const memberIds = useMemo(() => members.map((m) => m.user_id), [members]);
  const presence = usePresence(api, memberIds, visible);

  const { online, offline } = useMemo(() => {
    const on: ChannelMember[] = [];
    const off: ChannelMember[] = [];
    for (const m of members) {
      if (m.user_id === me?.id) {
        // Always show self online
        on.push(m);
      } else if (presence[m.user_id]) {
        on.push(m);
      } else {
        off.push(m);
      }
    }
    const sortByRoleThenName = (a: ChannelMember, b: ChannelMember) => {
      const ra = a.role === 'admin' ? 0 : 1;
      const rb = b.role === 'admin' ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.username.localeCompare(b.username);
    };
    on.sort(sortByRoleThenName);
    off.sort(sortByRoleThenName);
    return { online: on, offline: off };
  }, [members, presence, me]);

  if (!visible) return null;

  return (
    <aside className="hidden lg:flex w-60 shrink-0 bg-[#2b2d31] flex-col border-l border-black/30">
      <div className="px-4 py-3 border-b border-white/5">
        <h2 className="text-[#80848e] text-[10px] font-bold uppercase tracking-widest">
          Members — {members.length}
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-[#80848e]">
            <Spinner size={18} />
          </div>
        ) : error ? (
          <p className="text-xs text-[#ed4245] px-2 py-3">{error}</p>
        ) : members.length === 0 ? (
          <p className="text-xs text-[#4e5058] px-2 py-3">No members</p>
        ) : (
          <>
            <Group label={`Online — ${online.length}`} members={online} presence={presence} meId={me?.id} />
            <Group label={`Offline — ${offline.length}`} members={offline} presence={presence} meId={me?.id} dimmed />
          </>
        )}
      </div>
    </aside>
  );
});

export default MembersPanel;

// ─── Sub-components ────────────────────────────────────────────────────────────

interface GroupProps {
  label: string;
  members: ChannelMember[];
  presence: Record<string, boolean>;
  meId: string | undefined;
  dimmed?: boolean;
}

const Group = memo(function Group({ label, members, presence, meId, dimmed }: GroupProps) {
  if (members.length === 0) return null;
  return (
    <div className={`mb-3 ${dimmed ? 'opacity-50' : ''}`}>
      <p className="px-2 pt-1 pb-1.5 text-[#80848e] text-[10px] font-bold uppercase tracking-widest">
        {label}
      </p>
      <ul className="space-y-0.5">
        {members.map((m) => (
          <MemberRow
            key={m.user_id}
            member={m}
            online={m.user_id === meId ? true : !!presence[m.user_id]}
            isSelf={m.user_id === meId}
          />
        ))}
      </ul>
    </div>
  );
});

const MemberRow = memo(function MemberRow({
  member,
  online,
  isSelf,
}: {
  member: ChannelMember;
  online: boolean;
  isSelf: boolean;
}) {
  return (
    <li>
      <div className="flex items-center gap-2.5 px-2 py-1 rounded hover:bg-[#35373c] cursor-default group">
        <Avatar
          name={member.username}
          size={32}
          online={online}
          ringClass="ring-[#2b2d31]"
        />
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span
            className={`text-sm font-medium truncate ${
              online ? 'text-[#dbdee1]' : 'text-[#80848e]'
            }`}
          >
            {member.username}
            {isSelf && <span className="text-[#80848e] font-normal ml-1">(you)</span>}
          </span>
          {member.role === 'admin' && (
            <span
              title="Admin"
              className="shrink-0 px-1.5 py-px bg-[#5865f2]/20 text-[#7289da] text-[9px] font-bold uppercase tracking-wide rounded"
            >
              Admin
            </span>
          )}
        </div>
      </div>
    </li>
  );
});
