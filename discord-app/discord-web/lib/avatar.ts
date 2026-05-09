const PALETTE = [
  'from-[#5865f2] to-[#7289da]',
  'from-[#23a559] to-[#1e8c4a]',
  'from-[#f0b132] to-[#e67e22]',
  'from-[#eb459e] to-[#ad2e7a]',
  'from-[#00bcd4] to-[#0094a8]',
  'from-[#9c27b0] to-[#6a1b9a]',
  'from-[#f04747] to-[#c53537]',
  'from-[#7289da] to-[#5865f2]',
];

export function avatarGradient(seed: string | null | undefined): string {
  if (!seed) return PALETTE[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed[0]!.toUpperCase();
}
