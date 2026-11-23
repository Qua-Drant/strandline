// Space-map layout: free space as a true-proportion band along the top, categories below,
// and within each category a squarified treemap whose blocks never shrink under a readable label box.
// Fragments that would be too small fold together, but only with blocks of the same safety level.
import type { Cat, MapLevel } from '../services/types';

export const MINW = 84, MINH = 38;
type Rect = [x: number, y: number, w: number, h: number];
interface Unit { key: string; v: number; lv?: MapLevel; mem?: string[]; cl?: boolean }

export interface Box { x: number; y: number; w: number; h: number; mode: 'full' | 'compact'; members?: string[]; lv?: MapLevel; merged?: string }
export interface Sect { x: number; y: number; w: number; h: number; hh: number; label: string; solo: boolean }
export interface Layout { free: { x: number; y: number; w: number; h: number }; sects: Record<string, Sect>; cells: Record<string, Box>; clusters: Record<string, Box> }
export type MapItems = Record<string, { id: string; v: number; level: MapLevel }>;

/** Rough text width in px for the UI font (CJK full-width, Latin narrower). */
export const tw = (str: string, px: number) => {
  let w = 4;
  for (const ch of String(str)) {
    const c = ch.charCodeAt(0);
    w += c > 0x2E80 ? px : /[A-Z0-9]/.test(ch) ? px * 0.74 : ch === ' ' ? px * 0.3 : /[a-z]/.test(ch) ? px * 0.58 : px * 0.45;
  }
  return w;
};

const modeOf = (_w: number, h: number): Box['mode'] => (h >= 34 ? 'full' : 'compact');

function worst(row: { a: number }[], side: number) {
  let s = 0, mx = 0, mn = Infinity;
  row.forEach((r) => { s += r.a; mx = Math.max(mx, r.a); mn = Math.min(mn, r.a); });
  return Math.max(side * side * mx / (s * s), (s * s) / (side * side * mn));
}

function squarify(items: Unit[], x: number, y: number, w: number, h: number) {
  const out: Record<string, Rect> = {};
  const total = items.reduce((a, b) => a + b.v, 0);
  if (!items.length || w <= 0 || h <= 0 || total <= 0) return out;
  const k = (w * h) / total;
  let rest = items.map((it) => ({ key: it.key, a: it.v * k }));
  let rx = x, ry = y, rw = w, rh = h;
  while (rest.length) {
    const side = Math.min(rw, rh);
    let row = [rest[0]], best = worst(row, side), i = 1;
    while (i < rest.length) { const cand = row.concat([rest[i]]); const wv = worst(cand, side); if (wv <= best) { row = cand; best = wv; i++; } else break; }
    const sum = row.reduce((a, b) => a + b.a, 0);
    if (rw >= rh) { const cw = sum / rh; let cy = ry; row.forEach((r) => { const hh = r.a / cw; out[r.key] = [rx, cy, cw, hh]; cy += hh; }); rx += cw; rw -= cw; }
    else { const ch = sum / rw; let cx = rx; row.forEach((r) => { const ww = r.a / ch; out[r.key] = [cx, ry, ww, ch]; cx += ww; }); ry += ch; rh -= ch; }
    rest = rest.slice(row.length);
  }
  return out;
}

/** Squarified layout that won't add an item to a row if that makes any block thinner than the label box. */
function squarifyC(items: Unit[], x: number, y: number, w: number, h: number, mw = MINW, mh = MINH) {
  const out: Record<string, Rect> = {};
  const total = items.reduce((a, b) => a + b.v, 0);
  if (!items.length || w <= 0 || h <= 0 || total <= 0) return out;
  const k = (w * h) / total;
  let rest = items.map((it) => ({ key: it.key, a: it.v * k }));
  let rx = x, ry = y, rw = w, rh = h;
  while (rest.length) {
    const vert = rw >= rh, side = vert ? rh : rw;
    const thickMin = (vert ? mw : mh) + 3, extMin = (vert ? mh : mw) + 3;
    const st = (r: { a: number }[]) => { const sum = r.reduce((a, b) => a + b.a, 0), t = sum / side; let e = Infinity; r.forEach((q) => { e = Math.min(e, q.a / t); }); return { t, e, wv: worst(r, side) }; };
    let row = [rest[0]], cur = st(row), i = 1;
    while (i < rest.length) {
      const cand = row.concat([rest[i]]), nx = st(cand);
      if ((nx.wv <= cur.wv || cur.t < thickMin) && nx.e >= extMin) { row = cand; cur = nx; i++; } else break;
    }
    const t = cur.t;
    if (vert) { let cy = ry; row.forEach((r) => { const hh = r.a / t; out[r.key] = [rx, cy, t, hh]; cy += hh; }); rx += t; rw -= t; }
    else { let cx = rx; row.forEach((r) => { const ww = r.a / t; out[r.key] = [cx, ry, ww, t]; cx += ww; }); ry += t; rh -= t; }
    rest = rest.slice(row.length);
  }
  return out;
}

/** If a block still falls under the minimum box, borrow area from its larger siblings until it fits. */
function fitUnits(units: Unit[], x: number, y: number, w: number, h: number, mw = MINW, mh = MINH) {
  const wt: Record<string, number> = {}; units.forEach((u) => { wt[u.key] = u.v; });
  let r: Record<string, Rect> = {};
  for (let n = 0; n < 8; n++) {
    const list = units.map((u) => ({ key: u.key, v: wt[u.key] })).sort((a, b) => b.v - a.v);
    r = squarifyC(list, x, y, w, h, mw, mh);
    const tot = list.reduce((a, b) => a + b.v, 0);
    let bad = false;
    list.forEach((u) => {
      const q = r[u.key], f = Math.max((mw + 3) / q[2], (mh + 3) / q[3]);
      if (f > 1.005 && u.v / tot < 0.6) { bad = true; wt[u.key] = u.v * Math.min(2.5, f * 1.03); }
    });
    if (!bad) break;
  }
  return r;
}

/** 1-D split proportional to values, but no piece shorter than min (when there is room). */
function spread(vals: number[], len: number, min: number) {
  const n = vals.length;
  if (!n) return [];
  if (n * min >= len) return vals.map(() => len / n);
  const fixed = vals.map(() => false), out = vals.slice();
  for (let it = 0; it <= n; it++) {
    const freeLen = len - fixed.filter(Boolean).length * min;
    const freeSum = vals.reduce((a, v, i) => a + (fixed[i] ? 0 : v), 0);
    let changed = false;
    vals.forEach((v, i) => { out[i] = fixed[i] ? min : freeLen * v / freeSum; });
    vals.forEach((_, i) => { if (!fixed[i] && out[i] < min) { fixed[i] = true; changed = true; } });
    if (!changed) break;
  }
  return out;
}

/** k balanced columns (or rows), blocks stacked inside each one. */
function stripLayout(units: Unit[], X: number, Y: number, W: number, H: number, k: number, vert: boolean, mw = MINW, mh = MINH) {
  const cols = Array.from({ length: k }, () => ({ us: [] as Unit[], sum: 0 }));
  units.slice().sort((a, b) => b.v - a.v).forEach((u) => { const c = cols.reduce((m, q) => (q.sum < m.sum ? q : m)); c.us.push(u); c.sum += u.v; });
  const live = cols.filter((c) => c.us.length);
  const ws = spread(live.map((c) => c.sum), vert ? W : H, (vert ? mw : mh) + 3);
  const out: Record<string, Rect> = {}; let p = vert ? X : Y;
  live.forEach((c, i) => {
    const hs = spread(c.us.map((u) => u.v), vert ? H : W, (vert ? mh : mw) + 3);
    let q = vert ? Y : X;
    c.us.forEach((u, j) => { out[u.key] = vert ? [p, q, ws[i], hs[j]] : [q, p, hs[j], ws[i]]; q += hs[j]; });
    p += ws[i];
  });
  return out;
}

/** No block under the minimum box, least area distortion, aspect ratios near 1:1 to 2.2:1. */
function scoreLayout(r: Record<string, Rect>, units: Unit[], W: number, H: number, mw = MINW, mh = MINH) {
  const tot = units.reduce((a, u) => a + u.v, 0), area = W * H;
  let viol = 0, dist = 0, asp = 0;
  units.forEach((u) => {
    const q = r[u.key];
    if (!q) { viol++; return; }
    const w = q[2] - 3, h = q[3] - 3;
    if (w < mw - 0.5 || h < mh - 0.5) viol += 1 + 4 * (u.v / tot);
    dist += Math.abs(q[2] * q[3] - area * u.v / tot) / area;
    asp += Math.max(0, Math.max(w / h, h / w) - 2.2) * (u.v / tot);
  });
  return viol * 1000 + dist * 10 + asp;
}

function bestLayout(units: Unit[], X: number, Y: number, W: number, H: number) {
  const sorted = units.slice().sort((a, b) => b.v - a.v);
  const cands = [squarifyC(sorted, X, Y, W, H), fitUnits(units, X, Y, W, H)];
  for (let k = 1; k <= Math.min(4, units.length); k++) { cands.push(stripLayout(units, X, Y, W, H, k, true)); cands.push(stripLayout(units, X, Y, W, H, k, false)); }
  let best = cands[0], bs = Infinity;
  cands.forEach((r) => { const sc = scoreLayout(r, units, W, H); if (sc < bs - 1e-9) { bs = sc; best = r; } });
  return best;
}

export function layoutMap(W: number, H: number, free: number, total: number, items: MapItems, cats: Cat[]): Layout {
  const out: Layout = { free: { x: 0, y: 0, w: W, h: 0 }, sects: {}, cells: {}, clusters: {} };
  const fh = Math.max(28, H * free / total);
  out.free = { x: 0, y: 0, w: W, h: fh };
  const ry = fh + 6, rh = Math.max(0, H - ry);
  const live = cats.map((c) => ({ c, its: c.items.map((id) => items[id]).filter((it) => it && it.v > 0.05) }))
    .map((o) => ({ ...o, v: o.its.reduce((a, it) => a + it.v, 0) })).filter((o) => o.v > 0.05).sort((a, b) => b.v - a.v);
  const top: Unit[] = live.map((o) => ({ key: o.c.id, v: o.v }));
  const SW = 96, SH = 72;
  // every section must hold its blocks stacked or side by side; the minimum block count is its number of safety levels
  const NLV: Record<string, number> = {}; live.forEach((o) => { NLV[o.c.id] = new Set(o.its.map((it) => it.level)).size; });
  const need = (key: string, q: Rect | undefined) => {
    if (!q) return 9;
    const n = NLV[key], w = q[2] - 9, h = q[3] - 6 - 26;
    if (w <= 0 || h <= 0) return 9;
    const st = Math.max((MINW + 3) / w, n * (MINH + 3) / h), row = Math.max(n * (MINW + 3) / w, (MINH + 3) / h);
    return Math.min(st, row);
  };
  const sScore = (r: Record<string, Rect>) => {
    const area = (W + 6) * (rh + 6), tot = top.reduce((a, u) => a + u.v, 0); let viol = 0, dist = 0;
    top.forEach((u) => { const q = r[u.key]; const f = need(u.key, q); if (f > 1.005) viol += 1 + 4 * u.v / tot; if (q) dist += Math.abs(q[2] * q[3] - area * u.v / tot) / area; });
    return viol * 1000 + dist * 10;
  };
  let sr = squarify(top, -3, ry - 3, W + 6, rh + 6), ss = sScore(sr);
  if (ss >= 1000) {
    const wt: Record<string, number> = {}; top.forEach((u) => { wt[u.key] = u.v; });
    for (let n = 0; n < 16 && ss >= 1000; n++) {
      const list = top.map((u) => ({ key: u.key, v: wt[u.key] })).sort((a, b) => b.v - a.v);
      const tot = list.reduce((a, b) => a + b.v, 0);
      let cur: Record<string, Rect> = {}, cs = Infinity;
      [squarify(list, -3, ry - 3, W + 6, rh + 6), squarifyC(list, -3, ry - 3, W + 6, rh + 6, SW, SH)].forEach((r2) => { const s2 = sScore(r2); if (s2 < cs) { cs = s2; cur = r2; } });
      if (cs < ss) { ss = cs; sr = cur; }
      list.forEach((u) => { const f = need(u.key, cur[u.key]); if (f > 1.005 && u.v / tot < 0.6) wt[u.key] = u.v * Math.min(3, f * f * 1.04); });
    }
  }
  live.forEach((o) => {
    const r = sr[o.c.id];
    const nw = tw(o.c.name, 11) + 14, gw = 44;
    const sw = Math.max(0, r[2] - 6);
    const s: Sect = { x: r[0] + 3, y: r[1] + 3, w: sw, h: Math.max(0, r[3] - 6), hh: nw + gw > sw ? 32 : 20, label: nw <= sw ? o.c.name : o.c.short, solo: o.its.length === 1 };
    out.sects[o.c.id] = s;
    const X = s.x + 1.5, Y = s.y + s.hh - 1.5, Wd = Math.max(0, s.w - 3), Hd = Math.max(0, s.h - s.hh);
    let units: Unit[] = o.its.map((it) => ({ key: it.id, v: it.v, lv: it.level, mem: [it.id] }));
    const fold = (lv: MapLevel, clu: Unit | undefined, parts: Unit[]) => {
      const mem = (clu ? clu.mem! : []).concat(...parts.map((u) => u.mem!));
      units = units.filter((u) => u !== clu && parts.indexOf(u) < 0);
      units.push({ key: 'cl:' + o.c.id + ':' + lv, cl: true, lv, mem, v: mem.reduce((a, id) => a + items[id].v, 0) });
    };
    for (let n = 0; n < 4; n++) {
      const nat = squarifyC(units.slice().sort((a, b) => b.v - a.v), X, Y, Wd, Hd);
      const area = (u: Unit) => nat[u.key][2] * nat[u.key][3];
      const frag = units.filter((u) => (nat[u.key][2] - 3 < MINW || nat[u.key][3] - 3 < MINH) && area(u) < (MINW + 3) * (MINH + 3) * 1.25);
      let changed = false;
      (['L1', 'L2', 'L4'] as MapLevel[]).forEach((lv) => {
        const fl = frag.filter((u) => u.lv === lv);
        const clu = units.find((u) => u.cl && u.lv === lv);
        const parts = fl.filter((u) => u !== clu);
        if (!parts.length || (!clu && parts.length < 2)) return;
        fold(lv, clu, parts);
        changed = true;
      });
      if (!changed) break;
    }
    let rects = bestLayout(units, X, Y, Wd, Hd);
    // still too small after the best arrangement (small windows): fold the offender into its own level's aggregate
    for (let n = 0; n < 3; n++) {
      const bad = units.filter((u) => !u.cl && u.lv !== 'L3' && (rects[u.key][2] - 3 < MINW - 0.5 || rects[u.key][3] - 3 < MINH - 0.5));
      let changed = false;
      (['L1', 'L2', 'L4'] as MapLevel[]).forEach((lv) => {
        const parts = bad.filter((u) => u.lv === lv), clu = units.find((u) => u.cl && u.lv === lv);
        if (!parts.length) return;
        if (!clu && parts.length < 2) {
          const mate = units.filter((u) => !u.cl && u.lv === lv && parts.indexOf(u) < 0).sort((a, b) => a.v - b.v)[0];
          if (!mate) return;
          parts.push(mate);
        }
        fold(lv, clu, parts);
        changed = true;
      });
      if (!changed && bad.length) {
        // the cramped block has no same-level partner: free room by folding the two smallest blocks of another level
        const lv = (['L4', 'L1', 'L2'] as MapLevel[]).find((l) => units.filter((u) => !u.cl && u.lv === l).length >= 2 || (units.some((u) => u.cl && u.lv === l) && units.some((u) => !u.cl && u.lv === l)));
        if (lv) {
          const clu = units.find((u) => u.cl && u.lv === lv), plain = units.filter((u) => !u.cl && u.lv === lv).sort((a, b) => a.v - b.v);
          fold(lv, clu, clu ? plain.slice(0, 1) : plain.slice(0, 2));
          changed = true;
        }
      }
      if (!changed) break;
      rects = bestLayout(units, X, Y, Wd, Hd);
    }
    units.forEach((u) => {
      const q = rects[u.key];
      const b: Box = { x: q[0] + 1.5, y: q[1] + 1.5, w: Math.max(0, q[2] - 3), h: Math.max(0, q[3] - 3), mode: 'full' };
      b.mode = modeOf(b.w, b.h);
      if (u.cl) { b.members = u.mem; b.lv = u.lv; out.clusters[u.key] = b; u.mem!.forEach((id) => { out.cells[id] = { ...b, merged: u.key }; }); }
      else out.cells[u.key] = b;
    });
  });
  return out;
}
