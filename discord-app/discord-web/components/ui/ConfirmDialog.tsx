'use client';

import { useState } from 'react';
import { Modal } from './Modal';
import { Spinner } from './Spinner';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, renders the confirm button in a destructive style. */
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={busy ? () => undefined : onClose} widthClass="w-[420px]">
      <div className="px-6 pt-6 pb-2">
        <h3 className="text-white text-lg font-bold">{title}</h3>
        <p className="text-[#b5bac1] text-sm mt-2 leading-relaxed">{message}</p>
        {error && (
          <p className="mt-3 text-[#ed4245] text-sm bg-[#ed4245]/10 border border-[#ed4245]/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 px-6 pb-5 pt-4 bg-[#232428]">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="px-5 py-2 rounded-lg text-sm font-semibold text-[#dbdee1] hover:underline disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy}
          className={`min-w-[96px] px-5 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 ${
            destructive
              ? 'bg-[#da373c] hover:bg-[#a12d2f] text-white'
              : 'bg-[#5865f2] hover:bg-[#4752c4] text-white'
          }`}
        >
          {busy && <Spinner size={14} />}
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
