'use client';

import { type ReactNode, useEffect } from 'react';
import { useEscape } from '@/hooks/useEscape';

interface Props {
  onClose: () => void;
  /** Click outside the panel to close. Default true. */
  closeOnBackdrop?: boolean;
  /** Press Esc to close. Default true. */
  closeOnEscape?: boolean;
  /** Tailwind width class for the panel (e.g. "w-[460px]"). */
  widthClass?: string;
  /** Tailwind max-height class for the panel. */
  maxHeightClass?: string;
  children: ReactNode;
  /** Optional id for aria-labelledby. */
  labelledBy?: string;
}

export function Modal({
  onClose,
  closeOnBackdrop = true,
  closeOnEscape = true,
  widthClass = 'w-[460px]',
  maxHeightClass = 'max-h-[85vh]',
  children,
  labelledBy,
}: Props) {
  useEscape(onClose, closeOnEscape);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-[fadeIn_120ms_ease-out]"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div
        className={`bg-[#2b2d31] rounded-2xl ${widthClass} ${maxHeightClass} flex flex-col shadow-2xl border border-white/5 overflow-hidden animate-[scaleIn_140ms_ease-out]`}
      >
        {children}
      </div>
    </div>
  );
}
