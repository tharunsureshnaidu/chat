/**
 * ChannelSettingsModal — Tabbed admin/member panel for a channel.
 *
 *   Overview — edit name/description/visibility (admin only)
 *   Members  — list members; admin can kick
 *   Invite   — send invite by username (admin only)
 *   Danger   — leave channel / delete channel
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiClient } from '@dis/api';
import type { Channel, ChannelMember, ChannelSummary } from '@dis/types';
import { useDisStore } from '@dis/store';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/lib/toast';

type Tab = 'overview' | 'members' | 'invite' | 'danger';

interface Props {
  api: ApiClient;
  channel: ChannelSummary;
  onClose: () => void;
  onChannelUpdated: (channel: ChannelSummary) => void;
  onLeftOrDeleted: (channelId: string) => void;
}

const SLUG_RE = /^[a-z0-9_-]{2,100}$/;

export default function ChannelSettingsModal({
  api,
  channel,
  onClose,
  onChannelUpdated,
  onLeftOrDeleted,
}: Props) {
  const me = useDisStore((s) => s.user);
  const isAdmin = channel.my_role === 'admin';

  const initialTab: Tab = 'overview';
  const [tab, setTab] = useState<Tab>(initialTab);

  const tabs = useMemo(() => {
    const all: { id: Tab; label: string }[] = [
      { id: 'overview', label: 'Overview' },
      { id: 'members', label: 'Members' },
    ];
    if (isAdmin) all.push({ id: 'invite', label: 'Invite' });
    all.push({ id: 'danger', label: isAdmin ? 'Delete' : 'Leave' });
    return all;
  }, [isAdmin]);

  return (
    <Modal onClose={onClose} widthClass="w-[640px]" labelledBy="channel-settings-title">
      <div className="flex flex-1 min-h-0">
        {/* Sidebar tabs */}
        <nav className="w-44 shrink-0 bg-[#232428] py-4 px-2 border-r border-black/20 overflow-y-auto">
          <p
            id="channel-settings-title"
            className="text-[#80848e] text-[10px] font-bold uppercase tracking-widest px-2 mb-2 truncate"
            title={channel.name}
          >
            #{channel.name}
          </p>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors mb-0.5 ${
                tab === t.id
                  ? 'bg-[#404249] text-white'
                  : t.id === 'danger'
                  ? 'text-[#f38ba8] hover:bg-[#3d1515]'
                  : 'text-[#b5bac1] hover:bg-[#35373c] hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* Content area */}
        <div className="flex-1 min-w-0 max-h-[78vh] overflow-y-auto">
          <div className="px-6 py-5 flex items-start justify-between sticky top-0 bg-[#2b2d31] z-10 border-b border-black/20">
            <h2 className="text-white font-bold text-lg capitalize">
              {tab === 'danger' ? (isAdmin ? 'Delete Channel' : 'Leave Channel') : tab}
            </h2>
            <button
              onClick={onClose}
              className="text-[#80848e] hover:text-white hover:bg-white/10 w-8 h-8 flex items-center justify-center rounded-lg"
              aria-label="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>

          <div className="px-6 py-5">
            {tab === 'overview' && (
              <OverviewTab
                api={api}
                channel={channel}
                isAdmin={isAdmin}
                onSaved={onChannelUpdated}
              />
            )}
            {tab === 'members' && (
              <MembersTab api={api} channel={channel} isAdmin={isAdmin} meId={me?.id} />
            )}
            {tab === 'invite' && isAdmin && <InviteTab api={api} channel={channel} />}
            {tab === 'danger' && (
              <DangerTab
                api={api}
                channel={channel}
                isAdmin={isAdmin}
                meId={me?.id}
                onClose={onClose}
                onLeftOrDeleted={onLeftOrDeleted}
              />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Overview ──────────────────────────────────────────────────────────────────

function OverviewTab({
  api,
  channel,
  isAdmin,
  onSaved,
}: {
  api: ApiClient;
  channel: ChannelSummary;
  isAdmin: boolean;
  onSaved: (c: ChannelSummary) => void;
}) {
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description ?? '');
  const [isPublic, setIsPublic] = useState(channel.is_public);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== channel.name ||
    description !== (channel.description ?? '') ||
    isPublic !== channel.is_public;

  const nameValid = SLUG_RE.test(name);

  async function save() {
    if (!isAdmin || !dirty) return;
    if (!nameValid) {
      setError('Name must be 2–100 chars, lowercase letters, numbers, hyphens or underscores.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const patch: { name?: string; description?: string; is_public?: boolean } = {};
      if (name !== channel.name) patch.name = name;
      if (description !== (channel.description ?? '')) patch.description = description;
      if (isPublic !== channel.is_public) patch.is_public = isPublic;
      const updated: Channel = await api.updateChannel(channel.id, patch);
      const summary: ChannelSummary = {
        ...channel,
        ...updated,
      };
      onSaved(summary);
      toast.success('Channel updated');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 max-w-md">
      {!isAdmin && (
        <p className="text-xs text-[#80848e] bg-[#232428] border border-[#3a3c43] rounded-lg px-3 py-2">
          Only admins can edit channel settings. You can view them below.
        </p>
      )}

      <Field label="Channel Name">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4e5058]">#</span>
          <input
            value={name}
            disabled={!isAdmin || saving}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
            className="w-full pl-7 pr-3 py-2 bg-[#1e1f22] text-white rounded text-sm outline-none border border-transparent focus:border-[#5865f2]/50 disabled:opacity-60"
          />
        </div>
        {!nameValid && name.length > 0 && (
          <p className="text-[11px] text-[#f38ba8] mt-1">
            Must be 2–100 chars: a–z, 0–9, hyphen, underscore.
          </p>
        )}
      </Field>

      <Field label="Description">
        <textarea
          value={description}
          disabled={!isAdmin || saving}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={500}
          className="w-full px-3 py-2 bg-[#1e1f22] text-white rounded text-sm outline-none border border-transparent focus:border-[#5865f2]/50 disabled:opacity-60 resize-none"
          placeholder="What's this channel about?"
        />
      </Field>

      <Field label="Visibility">
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: true, icon: '🌐', label: 'Public', desc: 'Anyone can find and join' },
            { value: false, icon: '🔒', label: 'Private', desc: 'Invite only or join request' },
          ].map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              disabled={!isAdmin || saving}
              onClick={() => setIsPublic(opt.value)}
              className={`flex flex-col px-3 py-2 rounded-lg border-2 text-left transition-colors disabled:opacity-60 ${
                isPublic === opt.value
                  ? 'border-[#5865f2] bg-[#5865f2]/10'
                  : 'border-[#3a3c43] hover:border-[#4e5058] bg-[#1e1f22]'
              }`}
            >
              <span className="text-lg">{opt.icon}</span>
              <p className="text-white text-sm font-semibold">{opt.label}</p>
              <p className="text-[#80848e] text-[11px] leading-tight">{opt.desc}</p>
            </button>
          ))}
        </div>
      </Field>

      {error && (
        <p className="text-[#ed4245] text-sm bg-[#ed4245]/10 border border-[#ed4245]/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {isAdmin && (
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={() => {
              setName(channel.name);
              setDescription(channel.description ?? '');
              setIsPublic(channel.is_public);
              setError(null);
            }}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold text-[#dbdee1] hover:underline disabled:opacity-40"
          >
            Reset
          </button>
          <button
            type="button"
            disabled={saving || !dirty || !nameValid}
            onClick={save}
            className="min-w-[100px] px-4 py-1.5 rounded-lg text-sm font-semibold bg-[#5865f2] hover:bg-[#4752c4] text-white disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving && <Spinner size={14} />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Members ───────────────────────────────────────────────────────────────────

function MembersTab({
  api,
  channel,
  isAdmin,
  meId,
}: {
  api: ApiClient;
  channel: ChannelSummary;
  isAdmin: boolean;
  meId: string | undefined;
}) {
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmKick, setConfirmKick] = useState<ChannelMember | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .fetchMembers(channel.id)
      .then((m) => !cancelled && setMembers(m))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [api, channel.id]);

  async function performKick(target: ChannelMember) {
    await api.removeMember(channel.id, target.user_id);
    setMembers((p) => p.filter((m) => m.user_id !== target.user_id));
    toast.success(`Removed ${target.username}`);
  }

  return (
    <div className="space-y-2 max-w-md">
      {loading ? (
        <div className="flex items-center justify-center py-8 text-[#80848e]">
          <Spinner size={18} />
        </div>
      ) : error ? (
        <p className="text-[#ed4245] text-sm">{error}</p>
      ) : members.length === 0 ? (
        <p className="text-[#80848e] text-sm">No members.</p>
      ) : (
        members.map((m) => (
          <div
            key={m.user_id}
            className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#35373c]"
          >
            <Avatar name={m.username} size={36} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-white text-sm font-semibold truncate">
                  {m.username}
                  {m.user_id === meId && (
                    <span className="text-[#80848e] font-normal ml-1">(you)</span>
                  )}
                </p>
                {m.role === 'admin' && (
                  <span className="px-1.5 py-px bg-[#5865f2]/20 text-[#7289da] text-[9px] font-bold uppercase tracking-wide rounded">
                    Admin
                  </span>
                )}
              </div>
              <p className="text-[#80848e] text-[11px]">
                Joined {new Date(m.joined_at).toLocaleDateString()}
              </p>
            </div>
            {isAdmin && m.user_id !== meId && (
              <button
                onClick={() => setConfirmKick(m)}
                className="px-2.5 py-1 rounded text-[11px] font-semibold text-[#f38ba8] hover:bg-[#3d1515] hover:text-white transition-colors"
              >
                Remove
              </button>
            )}
          </div>
        ))
      )}

      {confirmKick && (
        <ConfirmDialog
          title={`Remove ${confirmKick.username}?`}
          message={`They will lose access to #${channel.name}. They can be invited again later.`}
          destructive
          confirmLabel="Remove"
          onClose={() => setConfirmKick(null)}
          onConfirm={async () => {
            try {
              await performKick(confirmKick);
            } catch (e) {
              throw e instanceof Error ? e : new Error(String(e));
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Invite ────────────────────────────────────────────────────────────────────

function InviteTab({ api, channel }: { api: ApiClient; channel: ChannelSummary }) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.inviteUser(channel.id, trimmed);
      setMessage({ kind: 'ok', text: `Invitation sent to ${trimmed}.` });
      setUsername('');
    } catch (e) {
      setMessage({
        kind: 'err',
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-md">
      <p className="text-[#b5bac1] text-sm">
        Send an invite to a user by their username. They&apos;ll need to accept it
        before joining.
      </p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username"
          autoFocus
          className="flex-1 px-3 py-2 bg-[#1e1f22] text-white rounded text-sm outline-none border border-transparent focus:border-[#5865f2]/50"
        />
        <button
          type="submit"
          disabled={busy || !username.trim()}
          className="min-w-[100px] px-4 py-2 rounded-lg text-sm font-semibold bg-[#5865f2] hover:bg-[#4752c4] text-white disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {busy && <Spinner size={14} />}
          {busy ? 'Sending…' : 'Send Invite'}
        </button>
      </form>
      {message && (
        <p
          className={`text-sm rounded-lg px-3 py-2 ${
            message.kind === 'ok'
              ? 'bg-[#1e3a2f] border border-[#23a559]/30 text-[#3ba55c]'
              : 'bg-[#3d1515] border border-[#ed4245]/30 text-[#f38ba8]'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

// ─── Danger ────────────────────────────────────────────────────────────────────

function DangerTab({
  api,
  channel,
  isAdmin,
  meId,
  onClose,
  onLeftOrDeleted,
}: {
  api: ApiClient;
  channel: ChannelSummary;
  isAdmin: boolean;
  meId: string | undefined;
  onClose: () => void;
  onLeftOrDeleted: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (isAdmin) {
    return (
      <div className="space-y-4 max-w-md">
        <p className="text-[#b5bac1] text-sm">
          Deleting <span className="text-white font-semibold">#{channel.name}</span>{' '}
          permanently removes all messages and member records. This action cannot
          be undone.
        </p>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#da373c] hover:bg-[#a12d2f] text-white"
        >
          Delete Channel
        </button>

        {confirming && (
          <ConfirmDialog
            title={`Delete #${channel.name}?`}
            message="This action is permanent. All messages and members will be removed."
            destructive
            confirmLabel="Delete"
            onClose={() => setConfirming(false)}
            onConfirm={async () => {
              await api.deleteChannel(channel.id);
              toast.success(`Deleted #${channel.name}`);
              onLeftOrDeleted(channel.id);
              onClose();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-md">
      <p className="text-[#b5bac1] text-sm">
        Leaving <span className="text-white font-semibold">#{channel.name}</span>{' '}
        will remove you from the member list. You can rejoin later if it&apos;s public,
        or wait for an invitation.
      </p>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#da373c] hover:bg-[#a12d2f] text-white"
      >
        Leave Channel
      </button>

      {confirming && (
        <ConfirmDialog
          title={`Leave #${channel.name}?`}
          message="You'll need to be re-invited or rejoin if it's public."
          destructive
          confirmLabel="Leave"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            if (!meId) return;
            await api.removeMember(channel.id, meId);
            toast.success(`Left #${channel.name}`);
            onLeftOrDeleted(channel.id);
            onClose();
          }}
        />
      )}
    </div>
  );
}

// ─── Field helper ──────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-[#80848e] uppercase tracking-widest mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
