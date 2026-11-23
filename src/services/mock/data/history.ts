// Demo 90-day free-space history for C:. Day 0 = 8/23, day 90 = today (11/21).
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

export const C_FREE_0 = 44.0;
