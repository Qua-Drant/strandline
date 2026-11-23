import type { History90 } from '../services/types';

export interface CalDay { kind: 'clean' | 'high' | 'calm' | 'none'; text: string }

const dayLabel = (h: History90, d: number) => { const t = new Date(h.start + d * 86400000); return (t.getMonth() + 1) + '月' + String(t.getDate()).padStart(2, '0') + '日'; };

/** Fill unknown days with the nearest known sample so the line stays continuous. */
export function filledLevel(h: History90, today: number): number[] {
  const a = h.level.slice();
  a[90] = today;
  let last: number | null = null;
  for (let i = 0; i < a.length; i++) { if (a[i] == null) a[i] = last; else last = a[i]; }
  let next: number | null = today;
  for (let i = a.length - 1; i >= 0; i--) { if (a[i] == null) a[i] = next; else next = a[i]; }
  return a as number[];
}

/** Describe one day of the 90-day calendar. */
export function calInfo(h: History90, level: number[], d: number, total = 512): CalDay {
  if (h.level[d] == null && d !== 90) return { kind: 'none', text: dayLabel(h, d) + ' · 没有记录' };
  const v = level[d], hi = v / total < 0.12, cl = h.cleans[d], mv = h.moves[d], rl = h.ruleDays[d];
  const bits = [d === 90 ? '今天' : dayLabel(h, d), '可用 ' + v.toFixed(1) + 'G'];
  if (cl) bits.push(cl[0] + ' 释放 ' + cl[1].toFixed(1) + 'G');
  if (mv) bits.push(mv[0] + ' ' + mv[1].toFixed(1) + 'G');
  if (rl) bits.push('规则代劳 ' + rl + ' 次');
  if (hi && !cl) bits.push('空间紧张');
  return { kind: cl ? 'clean' : hi ? 'high' : 'calm', text: bits.join(' · ') };
}

export const freed90 = (h: History90) =>
  Object.values(h.cleans).reduce((a, x) => a + x[1], 0) + Object.values(h.moves).reduce((a, x) => a + x[1], 0);

export const range90 = (h: History90) => {
  const f = (t: number) => { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate(); };
  return f(h.start) + ' – ' + f(h.start + 90 * 86400000);
};
