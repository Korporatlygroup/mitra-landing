import type { ReactNode } from 'react';

export type Tone = 'green' | 'gold' | 'blue' | 'coral' | 'gray' | 'violet';

/** Status pill. The words carry the meaning; the colour only reinforces it. */
export default function Tag({ tone = 'gray', children, large }: { tone?: Tone; children: ReactNode; large?: boolean }) {
  return <span className={`tag t-${tone}${large ? ' tag-lg' : ''}`}>{children}</span>;
}

/** Cover colours and tint for a business, picked from its id so a business keeps one colour everywhere. */
const PALETTE = [
  { c1: '#8c1d40', c2: 'rgba(244,165,28,0.55)', tint: '#f9e8ed' },
  { c1: '#8A5A00', c2: 'rgba(255,255,255,0.35)', tint: '#FEF0D2' },
  { c1: '#2446A8', c2: 'rgba(255,255,255,0.3)', tint: '#E7EDFC' },
  { c1: '#5435B8', c2: 'rgba(244,165,28,0.45)', tint: '#EEE9FC' },
  { c1: '#9A3412', c2: 'rgba(255,255,255,0.3)', tint: '#FCE7DE' },
  { c1: '#2a1a12', c2: 'rgba(244,165,28,0.5)', tint: '#f3ebdc' },
  { c1: '#5C0F28', c2: 'rgba(244,165,28,0.5)', tint: '#F3DCE3' },
];

export function paletteFor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initialsOf(name: string, max = 2): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, max)
    .map((p) => Array.from(p)[0]!.toUpperCase())
    .join('');
}
