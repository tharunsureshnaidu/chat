'use client';

import { useEffect, useState } from 'react';
import { dismissToast, subscribeToasts, type ToastItem } from '@/lib/toast';

const VARIANT_STYLES: Record<ToastItem['variant'], string> = {
  info: 'bg-[#2b2d31] border-[#404249] text-white',
  success: 'bg-[#1e3a2f] border-[#23a559]/40 text-[#3ba55c]',
  error: 'bg-[#3d1515] border-[#ed4245]/40 text-[#f38ba8]',
};

const VARIANT_ICONS: Record<ToastItem['variant'], string> = {
  info: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 6a1.25 1.25 0 110 2.5A1.25 1.25 0 0112 8zm1 9h-2v-6h2v6z',
  success: 'M9 16.17l-3.5-3.5L4 14.17 9 19.17 20 8.17 18.59 6.76z',
  error: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-2h2zm0-4h-2V7h2z',
};

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto min-w-[280px] max-w-md flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-2xl ${VARIANT_STYLES[t.variant]} animate-[slideIn_180ms_ease-out]`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 mt-0.5">
            <path d={VARIANT_ICONS[t.variant]} />
          </svg>
          <p className="text-sm leading-relaxed flex-1 break-words">{t.message}</p>
          <button
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            className="shrink-0 -mr-1 -mt-0.5 text-current opacity-60 hover:opacity-100"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
