/**
 * CreateChannelModal — Form to create a new chat channel.
 *
 * Fields: name (required), description (optional), public/private toggle.
 * On success, calls onCreated(channel) so the parent can add it to the store.
 */
'use client';

import { useState } from 'react';
import { ApiClient } from '@dis/api';
import type { ChannelSummary } from '@dis/types';

interface Props {
  api: ApiClient;
  onClose: () => void;
  onCreated: (channel: ChannelSummary) => void;
}

export default function CreateChannelModal({ api, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const channel = await api.createChannel(
        name.trim(),
        description.trim() || undefined,
        isPublic
      );
      const summary: ChannelSummary = { ...channel, member_count: 1, my_role: 'admin' };
      onCreated(summary);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#2b2d31] rounded-2xl w-[460px] shadow-2xl border border-white/5 overflow-hidden">
        {/* Header */}
        <div className="relative px-6 pt-5 pb-4 bg-linear-to-r from-[#5865f2]/15 via-transparent to-transparent">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-white font-bold text-xl tracking-tight">Create a Channel</h2>
              <p className="text-[#80848e] text-xs mt-0.5">Your channel, your rules</p>
            </div>
            <button
              onClick={onClose}
              className="text-[#80848e] hover:text-white hover:bg-white/10 w-8 h-8 flex items-center justify-center rounded-lg transition-all"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-5">
          {error && (
            <div className="px-4 py-2.5 bg-[#ed4245]/15 border border-[#ed4245]/30 text-[#ed4245] rounded-xl text-sm">
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-[10px] font-bold text-[#80848e] uppercase tracking-widest mb-2">
              Channel Name
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#4e5058] font-bold">#</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                placeholder="my-awesome-channel"
                required
                className="w-full pl-8 pr-4 py-2.5 bg-[#1e1f22] text-white rounded-xl text-sm outline-none placeholder-[#4e5058] border border-transparent focus:border-[#5865f2]/50 transition-colors"
                autoFocus
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[10px] font-bold text-[#80848e] uppercase tracking-widest mb-2">
              Description <span className="normal-case font-normal text-[#4e5058]">(optional)</span>
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this channel for?"
              className="w-full px-4 py-2.5 bg-[#1e1f22] text-white rounded-xl text-sm outline-none placeholder-[#4e5058] border border-transparent focus:border-[#5865f2]/50 transition-colors"
            />
          </div>

          {/* Visibility */}
          <div>
            <label className="block text-[10px] font-bold text-[#80848e] uppercase tracking-widest mb-2">
              Visibility
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                {
                  value: true,
                  icon: '🌐',
                  label: 'Public',
                  desc: 'Anyone can find and join',
                },
                {
                  value: false,
                  icon: '🔒',
                  label: 'Private',
                  desc: 'Invite only or join request',
                },
              ].map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => setIsPublic(opt.value)}
                  className={`flex flex-col px-4 py-3 rounded-xl border-2 text-left transition-all duration-150 ${
                    isPublic === opt.value
                      ? 'border-[#5865f2] bg-[#5865f2]/10 shadow-md shadow-[#5865f2]/10'
                      : 'border-[#383a40] hover:border-[#4e5058] bg-[#1e1f22]'
                  }`}
                >
                  <span className="text-xl mb-1">{opt.icon}</span>
                  <p className="text-white text-sm font-semibold">{opt.label}</p>
                  <p className="text-[#80848e] text-xs mt-0.5">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl text-sm font-semibold text-[#80848e] hover:text-white hover:bg-white/5 transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="px-5 py-2 bg-linear-to-r from-[#5865f2] to-[#7289da] text-white rounded-xl text-sm font-semibold hover:from-[#4752c4] hover:to-[#5865f2] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-[#5865f2]/25"
            >
              {loading ? 'Creating…' : 'Create Channel ✨'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
