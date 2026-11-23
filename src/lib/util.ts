export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const pct = (v: number, d: number) => (v / d * 100).toFixed(2) + '%';
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** Shorten a folder path in the middle by whole folders (never mid-word): %USERPROFILE%\…\hub\ */
export function shortHead(h: string, max: number): string {
  if (!h || h.length <= max) return h;
  const end = h.endsWith('\\') ? '\\' : '', parts = h.split('\\').filter((x) => x !== '');
  if (parts.length < 3) return h;
  let out = parts[parts.length - 1], i = parts.length - 2;
  while (i > 0 && (parts[0] + '\\…\\' + parts[i] + '\\' + out + end).length <= max) { out = parts[i] + '\\' + out; i--; }
  return parts[0] + '\\…\\' + out + end;
}

export type Level = 'L1' | 'L2' | 'L3';

/** C: capacity in GB; every "tight / ok" read in the app keys off this. */
export const C_TOTAL = 512;
export type Atmo = 'hi' | 'mid' | 'lo';
export const atmoOf = (free: number, total = C_TOTAL): Atmo => (free / total < 0.12 ? 'hi' : free / total < 0.2 ? 'mid' : 'lo');
export const ATMO_TEXT: Record<Atmo, string> = { hi: '空间紧张', mid: '空间偏紧', lo: '空间充足' };
