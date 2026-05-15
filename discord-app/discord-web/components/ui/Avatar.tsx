'use client';

import { memo } from 'react';
import { avatarGradient, initials } from '@/lib/avatar';

interface Props {
  name: string | null | undefined;
  size?: 24 | 28 | 32 | 36 | 40 | 48;
  online?: boolean | null;
  rounded?: 'full' | 'lg' | 'xl';
  /** Custom border color for the online dot ring (defaults to a dark surface color). */
  ringClass?: string;
  className?: string;
}

const SIZE_CLASS: Record<number, string> = {
  24: 'w-6 h-6 text-[10px]',
  28: 'w-7 h-7 text-[11px]',
  32: 'w-8 h-8 text-xs',
  36: 'w-9 h-9 text-sm',
  40: 'w-10 h-10 text-sm',
  48: 'w-12 h-12 text-base',
};

const DOT_SIZE: Record<number, string> = {
  24: 'w-2 h-2',
  28: 'w-2.5 h-2.5',
  32: 'w-2.5 h-2.5',
  36: 'w-3 h-3',
  40: 'w-3 h-3',
  48: 'w-3.5 h-3.5',
};

export const Avatar = memo(function Avatar({
  name,
  size = 36,
  online,
  rounded = 'full',
  ringClass = 'ring-[#2b2d31]',
  className = '',
}: Props) {
  const radius = rounded === 'full' ? 'rounded-full' : rounded === 'lg' ? 'rounded-lg' : 'rounded-xl';
  const grad = avatarGradient(name);
  return (
    <div className={`relative shrink-0 ${className}`}>
      <div
        className={`${SIZE_CLASS[size]} ${radius} bg-linear-to-br ${grad} flex items-center justify-center font-bold text-white select-none shadow-sm`}
      >
        {initials(name)}
      </div>
      {online !== undefined && online !== null && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 ${DOT_SIZE[size]} rounded-full ring-2 ${ringClass} ${
            online ? 'bg-[#23a559]' : 'bg-[#80848e]'
          }`}
          aria-label={online ? 'online' : 'offline'}
        />
      )}
    </div>
  );
});
