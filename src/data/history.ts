// 90-day tide calendar for C:. Day 0 = 8/23, day 90 = today (11/21).
// The last 30 days match the space map's tide meter.
export const HIST30 = [87.2, 86.1, 85.4, 84.9, 83.6, 82.8, 82.1, 80.9, 79.8, 78.6, 77.9, 76.4, 65.3, 64.2, 63.5, 62.1, 61.4, 60.2, 58.9, 57.8, 56.3, 55.1, 53.9, 52.4, 51.2, 50.1, 48.6, 47.4, 45.9];
export const CLEANS: Record<number, [string, number]> = { 7: ['常规清理', 21.3], 28: ['常规清理', 24.6], 56: ['常规清理', 18.6] };
export const MOVES90: Record<number, [string, number]> = { 50: ['迁移 Zotero 文献库 → D:', 6.4] };
export const RULEDAYS: Record<number, number> = {};
for (let k = 0; k < 28; k++) { const d = Math.round(1 + k * 3.2); RULEDAYS[d] = (RULEDAYS[d] || 0) + 1; }

export const LEVEL90: number[] = (() => {
  const a = new Array<number>(91);
  HIST30.forEach((v, i) => { a[61 + i] = v; });
  a[90] = 44.0; a[60] = 88.0;
  for (let d = 59; d >= 0; d--) { let v = a[d + 1] + 0.55; const ev = CLEANS[d + 1] || MOVES90[d + 1]; if (ev) v -= ev[1]; a[d] = v; }
  return a;
})();

/** One-tap cache clean on the overview (GB). */
export const FOAM = 25.2;
export const C_FREE_0 = 44.0;

export const CDAY = (d: number) => { const t = new Date(2026, 7, 23 + d); return (t.getMonth() + 1) + '月' + String(t.getDate()).padStart(2, '0') + '日'; };

export const freed90 = (extra = 0) =>
  Object.values(CLEANS).reduce((a, x) => a + x[1], 0) + Object.values(MOVES90).reduce((a, x) => a + x[1], 0) + extra;

export interface CalDay { kind: 'clean' | 'high' | 'calm'; text: string }

/** Describe one day of the 90-day calendar. `extraClean` marks today when the one-tap clean ran. */
export function calInfo(level: number[], d: number, extraClean?: [string, number] | null): CalDay {
  const v = level[d], hi = v / 512 < 0.12, cl = CLEANS[d] || (d === 90 ? extraClean ?? null : null), mv = MOVES90[d], rl = RULEDAYS[d];
  const bits = [d === 90 ? '今天' : CDAY(d), '可用 ' + v.toFixed(1) + 'G'];
  if (cl) bits.push(cl[0] + ' 释放 ' + cl[1].toFixed(1) + 'G');
  if (mv) bits.push(mv[0] + ' ' + mv[1].toFixed(1) + 'G');
  if (rl) bits.push('规则代劳 ' + rl + ' 次');
  if (hi && !cl) bits.push('空间紧张');
  return { kind: cl ? 'clean' : hi ? 'high' : 'calm', text: bits.join(' · ') };
}
