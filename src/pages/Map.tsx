import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { Icon } from '../components/Icon';
import { ALABEL, LVL } from '../lib/labels';
import { sound } from '../lib/sound';
import { layoutMap, MINW, tw, type Box, type MapItems } from '../lib/treemap';
import { ATMO_TEXT, atmoOf, clamp, cx } from '../lib/util';
import { PATHS } from '../routes';
import { diskService } from '../services/diskService';
import { skippedToast } from '../services/receipts';
import type { Cat, Leaf, MapAct, MapLevel, MapModel, Move } from '../services/types';
import { AppPortal, Cbx, Modal, Seg } from '../shell/parts';
import { Shell, Toasts } from '../shell/Shell';
import { useEscape, useShell } from '../shell/context';
import { DECO } from './map/deco';

// ---------- constants
const NW = 828, NH = 777;
/** demo only: representative changes on the 30-day tide meter (index 0 = 30 days ago, 29 = today) */
const TEV: Record<number, string> = diskService.mode === 'mock'
  ? { 0: '30 天前', 4: '微信聊天原图 +1.6G', 12: 'Docker 镜像 +9.8G', 18: 'Sentinel-2 下载 +1.3G', 24: 'pip 缓存 +1.5G', 29: '今日扫描' }
  : { 29: '今日扫描' };
const RUN_ORDER: MapAct[] = ['rebuild', 'setting', 'empty', 'recycle'];
const SHOW_ORDER: MapAct[] = ['rebuild', 'recycle', 'setting', 'empty'];
const pc = (v: number, d: number) => (v / d * 100).toFixed(3) + '%';
const driveOf = (path: string) => { const r = /^\s*([A-Za-z]):/.exec(path || ''); return r ? r[1].toUpperCase() : ''; };
const hhmm = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const EMPTY_MODEL: MapModel = { drive: { id: 'C', name: '', total: 1, free: 0, free30: 0 }, leaves: [], cats: [], moves: [], bin: 0, history30: [], scannedAt: '' };

type Phase = 'scanning' | 'results' | 'cleaning' | 'report';
type Overlay = null | 'bell' | 'menu' | 'detail' | 'move';
type Mode = 'all' | 'clean' | 'move';
type Ebb = null | 'lift' | 'wave' | 'grow';
interface Run { ids: string[]; amt: Record<string, number>; freed: number; bin: number }
interface Drag { x0: number; y0: number; x1: number; y1: number }
type Flags = Record<string, boolean>;

interface MapState {
  /** scan result from the disk service; null until the first load */
  model: MapModel | null;
  /** free space when the page opened, for the "清理前" mark on the free band */
  free0: number | null;
  phase: Phase; p: number; checked: Flags | null; undone: Flags; ignored: Flags;
  run: Run | null; receiptId: string | null; queue: string[]; qi: number; step: number; ebb: Ebb; ebbIds: Flags; tc: number | null;
  moving: string | null; movingTo: string; mp: number; paused: boolean;
  toEdits: Record<string, string>; verify: Flags; linkOff: Flags;
  overlay: Overlay; menu: { id: string; x: number; y: number; W: number; H: number } | null; detail: string | null; dOpen: boolean; moveId: string | null;
  editing: boolean; draft: string; mode: Mode; open: Record<string, boolean> | null; hover: string | null; pinned: string | null; focusCat: string | null;
  drag: Drag | null; confirm: boolean; lw: number; mapW: number; mapH: number; rem: Flags;
  /** map model frozen while the ebb wash plays, so blocks melt where they stood */
  frozen: { items: MapItems; free: number } | null;
  /** last known rect of every block, so removed ones collapse toward where they were */
  seen: Record<string, Box>;
}

const INIT: MapState = {
  model: null, free0: null,
  phase: 'results', p: 100, checked: null, undone: {}, ignored: {},
  run: null, receiptId: null, queue: [], qi: 0, step: 0, ebb: null, ebbIds: {}, tc: null, moving: null, movingTo: 'D', mp: 0, paused: false,
  toEdits: {}, verify: {}, linkOff: {}, overlay: null, menu: null, detail: null, dOpen: false, moveId: null, editing: false, draft: '',
  mode: 'all', open: null, hover: null, pinned: null, focusCat: null, drag: null, confirm: false, lw: 320, mapW: NW, mapH: NH,
  rem: { low: true, weekly: false, inst: true }, frozen: null, seen: {},
};

/** Class-style merged state, with a ref that always holds the latest value for timers. */
function useMergeState<T extends object>(init: T) {
  const [s, setS] = useState(init);
  const ref = useRef(s);
  useLayoutEffect(() => { ref.current = s; });
  const set = useCallback((p: Partial<T> | ((prev: T) => Partial<T>)) => {
    setS((prev) => { const n = { ...prev, ...(typeof p === 'function' ? p(prev) : p) }; ref.current = n; return n; });
  }, []);
  return [s, set, ref] as const;
}

export function MapPage() {
  const shell = useShell();
  const { cFree: sysFree, sys, drives, refreshDrives, pushToast, setPal, pal, setTask, setWriting, setSuggestN, setScanAt, appEl } = shell;
  const [s, set, sref] = useMergeState(INIT);
  const ebbT = useRef<number[]>([]);
  const mapEl = useRef<HTMLElement | null>(null);
  const mr = useRef<DOMRect | null>(null);
  const split = useRef<{ x: number; w: number } | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [openedAt] = useState(() => Date.now());

  // ---------- the model from the disk service
  const model = s.model ?? EMPTY_MODEL;
  const LEAVES: Leaf[] = model.leaves, CATS: Cat[] = model.cats, MOVES: Move[] = model.moves;
  const LEAF: Record<string, Leaf> = Object.fromEntries(LEAVES.map((l) => [l.id, l]));
  const TOTAL = model.drive.total, FREE30 = model.drive.free30, HIST30 = model.history30;
  // the scanned drive may not be the system drive (e.g. a sandbox folder on D:)
  const freeNow = s.model && model.drive.id !== sys.id ? (drives.find((d) => d.id === model.drive.id)?.free ?? model.drive.free) : sysFree;
  const FREE0 = s.free0 ?? freeNow;
  const moveOf = (id: string | null) => MOVES.find((m) => m.id === id);
  const reloadModel = async () => {
    const m = await diskService.getMapModel(sys.id);
    set({ model: m });
    setScanAt(m.scannedAt || '尚未');
    return m;
  };

  // ---------- model helpers
  const size = (id: string) => LEAF[id]?.gb ?? 0;
  const level = (id: string): MapLevel => LEAF[id]?.level ?? 'L4';
  const selectable = (id: string) => { const lv = level(id); return (lv === 'L1' || lv === 'L2' || lv === 'L3') && size(id) > 0.05 && !s.ignored[id] && !LEAF[id]?.cleaned; };
  const gain = (id: string) => { const L = LEAF[id]; if (!L) return 0; if (L.act === 'empty') return L.gb; return L.level === 'L2' ? Math.min(L.gain, L.gb) : L.gb; };
  const moveGb = (m: Move) => m.cells.reduce((a, c) => a + size(c), 0);
  const driveFree = (d: string) => drives.find((x) => x.id === d)?.free ?? 0;
  const migratable = (id: string) => { const L = LEAF[id]; return !!L?.move && !!moveOf(L.move) && size(id) > 0.05; };
  const items = (): MapItems => Object.fromEntries(LEAVES.map((l) => [l.id, { id: l.id, v: size(l.id), level: level(l.id) }]));
  const checked: Flags = s.checked ?? {};
  const toggle = (id: string) => { if (!selectable(id)) return; set((p) => ({ checked: { ...(p.checked ?? {}), [id]: !(p.checked ?? {})[id] } })); };
  const target = (m: Move) => s.toEdits[m.id] || m.to;

  // ---------- overlay bus: one at a time; any overlay kills hover cards
  const ov: Overlay | 'pal' = pal ? 'pal' : s.overlay;
  const openOverlay = (kind: Overlay, extra: Partial<MapState> = {}) => { setPal(false); set({ overlay: kind, hover: null, pinned: null, drag: null, dOpen: kind === 'detail', ...extra }); };
  const closeOverlay = () => {
    if (pal) { setPal(false); return; }
    if (sref.current.overlay === 'detail') {
      set({ overlay: null, dOpen: false });
      window.setTimeout(() => { if (!sref.current.dOpen) set({ detail: null }); }, 280);
    } else set({ overlay: null, menu: null, editing: false });
  };
  const openDetail = (id: string) => openOverlay('detail', { detail: id });
  const openMove = (id: string) => openOverlay('move', { moveId: id, editing: false, draft: '' });
  useEffect(() => { if (pal) set({ hover: null, pinned: null, drag: null, overlay: s.overlay === 'detail' ? 'detail' : null }); }, [pal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEscape(() => {
    const st = sref.current;
    if (st.overlay) closeOverlay();
    else if (st.confirm) set({ confirm: false });
    else if (st.pinned || st.focusCat) set({ pinned: null, focusCat: null });
  });

  const halt = () => { ebbT.current.forEach((t) => clearTimeout(t)); ebbT.current = []; };
  useEffect(() => () => { halt(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- scan
  const rescan = async () => {
    halt(); setPal(false);
    set({ phase: 'scanning', p: 0, confirm: false, overlay: null, dOpen: false, pinned: null, hover: null, drag: null });
    try {
      const m = await diskService.scan(sys.id, (pr) => set({ p: pr.p }));
      // first scan of this target: tick every rebuildable block, as the design does
      set((prev) => ({ model: m, p: 100, phase: 'results', free0: prev.free0 ?? m.drive.free,
        checked: prev.checked && Object.keys(prev.checked).length ? prev.checked : Object.fromEntries(m.leaves.filter((l) => l.level === 'L1' && !l.cleaned && l.gb > 0.05).map((l) => [l.id, true])) }));
      setScanAt(m.scannedAt);
      await refreshDrives();
      const v = m.leaves.filter((l) => ['L1', 'L2', 'L3'].includes(l.level) && !l.cleaned && l.gb > 0.05).reduce((a, l) => a + (l.level === 'L2' ? Math.min(l.gain, l.gb) : l.gb), 0);
      const mv = m.moves.reduce((a, mm) => a + mm.cells.reduce((x, c) => x + (m.leaves.find((l) => l.id === c)?.gb ?? 0), 0), 0);
      pushToast({ kind: 'ok', title: '扫描完成', sub: '可清理约 ' + v.toFixed(1) + ' GB · 可迁移 ' + mv.toFixed(1) + ' GB' }, 5000);
    } catch (e) {
      set({ phase: 'results', p: 100 });
      pushToast({ kind: 'err', title: '扫描没有完成', sub: String(e) }, 8000);
    }
  };
  const stopScan = () => { void diskService.cancelScan(); };

  // first load: use the last scan, or scan now if there is none
  useEffect(() => {
    let live = true;
    void diskService.getMapModel(sys.id).then((m) => {
      if (!live) return;
      set({ model: m, free0: m.drive.free, checked: Object.fromEntries(m.leaves.filter((l) => l.level === 'L1' && !l.cleaned && l.gb > 0.05).map((l) => [l.id, true])) });
      if (m.scannedAt) setScanAt(m.scannedAt); else void rescan();
    });
    return () => { live = false; };
  }, [sys.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The ebb wash (~950 ms): blocks lift, a sea-glass wave rises dissolving them as its ridge passes,
  // then the dry-sand free band grows while the hero number, sidebar and top glow follow.
  const runClean = () => {
    halt();
    const st = sref.current;
    const ids = Object.keys(checked).filter((id) => checked[id] && selectable(id)).sort((a, b) => RUN_ORDER.indexOf(LEAF[a].act) - RUN_ORDER.indexOf(LEAF[b].act));
    const ebbIds: Flags = Object.fromEntries(ids.map((id) => [id, true]));
    const job = diskService.clean(sys.id, ids);
    set({ frozen: { items: items(), free: freeNow }, phase: 'cleaning', queue: ids, qi: 0, step: 0, confirm: false, run: { ids: [], amt: {}, freed: 0, bin: 0 }, receiptId: null, undone: {}, overlay: null, dOpen: false, hover: null, pinned: null, ebb: 'lift', ebbIds });
    void st;
    const at = (ms: number, f: () => void) => { ebbT.current.push(window.setTimeout(f, ms)); };
    at(150, () => { set({ ebb: 'wave' }); sound.wash(false, 460); });
    // apply the result once both the wave has risen (560 ms) and the backend has answered
    const wave = new Promise<void>((r) => at(560, r));
    void Promise.all([job, wave]).then(async ([rc]) => {
      const run: Run = { ids: rc.items.map((i) => i.id), amt: Object.fromEntries(rc.items.map((i) => [i.id, i.gb])), freed: rc.freed, bin: rc.bin };
      const m = await diskService.getMapModel(sys.id);
      await refreshDrives();
      set({ model: m, run, receiptId: rc.id, qi: sref.current.queue.length, step: 0, ebb: 'grow', frozen: null });
      skippedToast(rc, pushToast);
      at(390, () => set({ phase: 'report', checked: {}, ebb: null }));
    }).catch((e) => {
      set({ phase: 'results', ebb: null, frozen: null, ebbIds: {} });
      pushToast({ kind: 'err', title: '清理没有完成', sub: String(e) }, 9000);
    });
  };

  const undo = async (id: string) => {
    const st = sref.current;
    if (!st.receiptId || !st.run) return;
    try {
      await diskService.undo(st.receiptId, id);
      const amt = st.run.amt[id], act = LEAF[id]?.act;
      const run = { ...st.run, ...(act === 'recycle' ? { bin: st.run.bin - amt } : { freed: st.run.freed - amt }) };
      set({ undone: { ...st.undone, [id]: true }, run });
      await reloadModel(); await refreshDrives();
    } catch (e) { pushToast({ kind: 'err', title: '没能撤销', sub: String(e) }, 8000); }
  };

  // ---------- migration: progress comes from the service
  useEffect(() => diskService.onMigration((pr) => {
    if (pr.state === 'running') set({ moving: pr.moveId, movingTo: pr.drive, mp: pr.pct, paused: false });
    else if (pr.state === 'paused') {
      set({ moving: pr.moveId, movingTo: pr.drive, mp: pr.pct, paused: true });
      pushToast({ kind: 'err', title: pr.message ?? '迁移已暂停', sub: '处理好之后点重试，已复制并校验过的部分会保留', action: '重试', run: () => { set({ paused: false }); void diskService.resumeMigration(pr.moveId); } });
    } else if (pr.state === 'done') {
      const name = moveOf(pr.moveId)?.name ?? '';
      set((p) => { const ck = { ...(p.checked ?? {}) }; (moveOf(pr.moveId)?.cells ?? []).forEach((c) => { delete ck[c]; }); return { moving: null, mp: 0, paused: false, checked: ck }; });
      void reloadModel(); void refreshDrives();
      pushToast({ kind: 'ok', title: name + '已迁移至 ' + pr.drive + ':', sub: sys.id + ': 多出 ' + pr.gb.toFixed(1) + ' GB', action: '打开新位置', run: () => { const m = moveOf(pr.moveId); if (m) void diskService.openPath(target(m)); } }, 6000);
    } else {
      set({ moving: null, mp: 0, paused: false });
      pushToast({ kind: 'err', title: '迁移没有完成', sub: pr.message ?? '源文件夹保持原样，没有删除任何文件' }, 10000);
    }
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const startMove = (to: string) => {
    const m = moveOf(sref.current.moveId);
    if (!m) return;
    const st = sref.current;
    set((p) => ({ moving: m.id, movingTo: driveOf(to) || 'D', toEdits: { ...p.toEdits, [m.id]: to }, mp: 0, paused: false, overlay: null, editing: false }));
    diskService.startMigration(m.id, to, { link: !st.linkOff[m.id], verify: !!st.verify[m.id] }).catch((e) => {
      set({ moving: null, mp: 0 });
      pushToast({ kind: 'err', title: '迁移没有开始', sub: String(e) }, 9000);
    });
  };

  // ---------- map size follows its element
  useEffect(() => {
    const el = mapEl.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight, st = sref.current;
      if (w > 80 && h > 80 && (Math.abs(w - st.mapW) > 4 || Math.abs(h - st.mapH) > 4)) set({ mapW: w, mapH: h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [set, sref]);

  // ---------- derived view
  const ph = s.phase, isScanning = ph === 'scanning', isResults = ph === 'results', isCleaning = ph === 'cleaning', isReport = ph === 'report';
  const W = s.mapW || NW, H = s.mapH || NH;
  const its = isCleaning && s.frozen ? s.frozen.items : items();
  const shownFree = isCleaning && s.frozen ? s.frozen.free : freeNow;
  const lay = layoutMap(W, H, shownFree, TOTAL, its, CATS);
  const sel = LEAVES.filter((l) => checked[l.id] && selectable(l.id)).map((l) => l.id);
  const selFree = isResults ? sel.filter((id) => LEAF[id].act !== 'recycle').reduce((a, id) => a + gain(id), 0) : 0;
  const selBin = isResults ? sel.filter((id) => LEAF[id].act === 'recycle').reduce((a, id) => a + gain(id), 0) : 0;
  const spot = isResults && s.confirm;
  const mode = s.mode;

  // marquee hit test (only 可重建 counts)
  let dg: null | { l: string; t: string; w: string; h: string; tl: string; tt: string; label: string; n: number; gb: number } = null;
  const hit: Flags = {}, inRect: Flags = {};
  if (s.drag) {
    const x0 = Math.min(s.drag.x0, s.drag.x1), x1 = Math.max(s.drag.x0, s.drag.x1), y0 = Math.min(s.drag.y0, s.drag.y1), y1 = Math.max(s.drag.y0, s.drag.y1);
    const X0 = x0 * W, X1 = x1 * W, Y0 = y0 * H, Y1 = y1 * H;
    const over = (b?: Box) => !!b && b.w > 0 && b.x < X1 && b.x + b.w > X0 && b.y < Y1 && b.y + b.h > Y0;
    LEAVES.forEach((l) => {
      if (!over(lay.cells[l.id]) || size(l.id) <= 0.05) return;
      inRect[l.id] = true;
      if (level(l.id) === 'L1' && selectable(l.id)) hit[l.id] = true;
    });
    const ids = Object.keys(hit), gb = ids.reduce((a, id) => a + gain(id), 0);
    const label = ids.length ? '框选 ' + ids.length + ' 项可重建 · ' + gb.toFixed(1) + ' GB' : '框选只会选中「可重建」项';
    const tagW = tw(label, 11) + 18;
    const tx = clamp(X1 - tagW, 0, W - tagW);
    let ty = Y0 - 10 - 22;
    const hitBoxes = ids.map((id) => lay.cells[id]).concat(LEAVES.filter((l) => checked[l.id]).map((l) => lay.cells[l.id])).filter(Boolean);
    const covers = (y: number) => hitBoxes.some((q) => tx < q.x + q.w && tx + tagW > q.x && y < q.y + 22 && y + 22 > q.y)
      || Object.values(lay.sects).some((sc) => tx < sc.x + sc.w && tx + tagW > sc.x && y < sc.y + sc.hh && y + 22 > sc.y);
    if (ty < lay.free.h || covers(ty)) ty = Math.max(4, (lay.free.h - 22) / 2);
    dg = { l: pc(X0, W), t: pc(Y0, H), w: pc(X1 - X0, W), h: pc(Y1 - Y0, H), tl: pc(tx, W), tt: pc(ty, H), label, n: ids.length, gb };
  }

  // the ridge rises from the map bottom over 410 ms; each block dissolves as it passes the block's middle
  const meltDelay = (b?: Box) => (b ? Math.round(clamp(1 - (b.y + b.h / 2) / H, 0, 1) * 410) + 'ms' : '0ms');
  const seenNow: Record<string, Box> = {};
  const rectStyle = (b: Box | { x: number; y: number; w: number; h: number } | null | undefined, id: string): CSSProperties => {
    if (b && b.w > 0) { seenNow[id] = b as Box; return { left: pc(b.x, W), top: pc(b.y, H), width: pc(b.w, W), height: pc(b.h, H) }; }
    const p = s.seen[id];
    return p ? { left: pc(p.x + p.w / 2, W), top: pc(p.y + p.h / 2, H), width: '0%', height: '0%' } : { left: '50%', top: '50%', width: '0%', height: '0%' };
  };
  const moveCells: Flags = {}, movingCells: Flags = {};
  MOVES.forEach((m) => m.cells.forEach((c) => { if (s.moving === m.id) movingCells[c] = true; if (ov === 'move' && s.moveId === m.id) moveCells[c] = true; }));
  const curId = isCleaning && !s.ebb ? s.queue[s.qi] : null;
  const doneIds: Flags = {}; if (isCleaning) s.queue.slice(0, s.qi).forEach((id) => { doneIds[id] = true; });
  // during a scan a thin sounding beam descends the map; blocks light up once the beam has passed their upper third
  const pending = (id: string) => { if (!isScanning) return false; const b = lay.cells[id]; return b && b.w > 0 ? b.y + b.h * 0.35 > H * s.p / 100 : s.p < LEAF[id].rv; };
  const dimFor = (id: string) => {
    if (spot) return !checked[id] || !selectable(id);
    if (s.focusCat && LEAF[id].cat !== s.focusCat) return true;
    if (mode === 'clean') return !selectable(id);
    if (mode === 'move') return !migratable(id);
    return false;
  };

  const ctxHandler = (id: string) => (e: RMouseEvent) => {
    e.preventDefault();
    if (sref.current.phase !== 'results') return;
    const r = appEl?.getBoundingClientRect() ?? { left: 0, top: 0, width: 1440, height: 900 } as DOMRect;
    openOverlay('menu', { menu: { id, x: e.clientX - r.left, y: e.clientY - r.top, W: r.width, H: r.height } });
  };

  const found = { n: 0, gb: 0 };
  const decoOf: Record<string, string> = {};
  CATS.forEach((c) => { let best: string | null = null, ba = 0; c.items.forEach((id) => { const bb = lay.cells[id]; if (!bb || bb.merged || bb.mode !== 'full' || bb.w < 120 || bb.h < 96) return; if (bb.w * bb.h > ba) { ba = bb.w * bb.h; best = id; } }); if (best) decoOf[best] = c.id; });

  const blocks = LEAVES.map((l) => {
    const id = l.id, b = lay.cells[id];
    const gone = !b || !!b.merged || its[id].v <= 0.05;
    const lv = level(id);
    const on = (isResults && !!checked[id] && selectable(id)) || !!hit[id];
    const sz = its[id].v, mv = !!movingCells[id];
    const pend = pending(id) && !gone;
    if (isScanning && !gone && !pend && lv !== 'L4') { found.n += 1; found.gb += sz; }
    const status = doneIds[id] ? '已清理' : s.ignored[id] ? '已忽略' : mv ? (s.paused ? '迁移已暂停 · ' : '迁移中 · ') + Math.round(s.mp) + '%' : '';
    const mvTag = lv === 'L4' && migratable(id) && !mv && !(b && b.mode === 'compact' && b.w < 110);
    const full = !b || b.mode === 'full';
    const tight = !!b && b.w < MINW - 0.5, narrow = !!b && b.w < 110;
    const sect = lay.sects[l.cat];
    const solo = !!b && !b.merged && !!sect && sect.solo && l.name === CATS.find((k) => k.id === l.cat)?.name;
    const padX = (lv === 'L3' ? 11 : 8) + 8 + (lv === 'L4' ? 0 : 14);
    const szS = status || sz.toFixed(1) + 'G';
    const availFull = b ? b.w - padX : 0;
    const availLine = b ? b.w - padX - tw(szS, 11) - 6 - (lv === 'L3' ? 48 : 0) - (mvTag ? 14 : 0) : 0;
    const pickName = (avail: number, px: number) => { const c = [l.name, l.short, l.xs].filter(Boolean); for (const n of c) if (tw(n, px) <= avail - 6) return n; return c[c.length - 1]; };
    const cls = cx('cell', 'lv-' + lv, solo ? 'm-solo' : full ? 'm-full' : 'm-compact', tight && 'is-tight', !!b && (b.w < 48 || b.h < 24) && 'is-mute', !!b && full && b.h < 46 && 'is-dense',
      lv === 'L4' && !mvTag && 'no-badge', gone && 'is-gone', on && 'is-sel', mvTag && 'has-mv', (s.hover === id || s.pinned === id) && 'is-hover', pend && 'is-pending',
      id === curId && 'is-active', doneIds[id] && 'is-done', mv && 'is-moving', mv && s.paused && 'is-mpause',
      (s.ebb === 'lift' || s.ebb === 'wave') && s.ebbIds[id] && 'is-lift', s.ebb !== 'lift' && s.ebbIds[id] && !s.undone[id] && 'is-melt',
      !mv && (moveCells[id] || (mode === 'move' && migratable(id) && !spot)) && 'is-preview', s.detail === id && s.dOpen && 'is-focus',
      !gone && dimFor(id) && 'is-dim', !!s.drag && inRect[id] && !hit[id] && 'is-spared');
    const deco = decoOf[id] && !mv && !gone ? decoOf[id] : null;
    return {
      key: id, style: { ...rectStyle(gone ? null : b, id), ['--md' as string]: meltDelay(b) }, cls, off: gone || pend, aria: l.name + '，' + sz.toFixed(1) + ' GB，' + LVL[lv],
      pressed: lv === 'L1' && !gone ? on : undefined, full: full && !solo, compact: !full && !solo, solo,
      name: full ? pickName(availFull, 12) : pickName(availLine, 11), l3: lv === 'L3',
      sizeText: status || sz.toFixed(1) + (narrow || tight ? 'G' : ' GB'), sizeShort: status || sz.toFixed(1) + 'G', szCls: cx('sz mono', mv && 'st'),
      sel: on, part: false, mvTag, mvText: b && b.w >= 120 ? '↗ 迁移' : '↗', deco, decCls: cx('dec', !!b && b.w >= 200 && b.h >= 170 && 'dec-l'),
      enter: () => { if (!sref.current.drag && sref.current.hover !== id) set({ hover: id }); },
      click: () => { if (!isResults) return; if (lv === 'L1' && selectable(id)) toggle(id); else openDetail(id); },
      ctx: ctxHandler(id),
    };
  });
  CATS.forEach((c) => (['L1', 'L2', 'L4'] as MapLevel[]).forEach((lvk) => {
    const key = 'cl:' + c.id + ':' + lvk, b = lay.clusters[key];
    const mem = b ? b.members! : [];
    const selM = mem.filter((m) => selectable(m));
    const onM = selM.filter((m) => (isResults && checked[m]) || hit[m]);
    const all = onM.length > 0 && onM.length === selM.length, part = onM.length > 0 && !all;
    const gb = mem.reduce((a, m) => a + its[m].v, 0), onGb = onM.reduce((a, m) => a + gain(m), 0);
    const nmL = (lvk === 'L1' && c.cl ? c.cl : '其他') + ' ×' + mem.length, nmS = '其他 ×' + mem.length;
    const nm = b && tw(nmL, b.h < 46 ? 11 : 12) > b.w - 16 - (lvk === 'L4' ? 0 : 14) ? nmS : nmL;
    const full = !b || b.mode === 'full';
    const pend = isScanning && mem.some((m) => pending(m));
    if (isScanning && b && !pend && lvk !== 'L4') { found.n += mem.length; found.gb += gb; }
    const allDim = mem.length > 0 && mem.every((m) => dimFor(m));
    const cmelt = s.ebb !== null && s.ebb !== 'lift' && mem.length > 0 && mem.every((m) => s.ebbIds[m]);
    blocks.push({
      key, style: { ...rectStyle(b, key), ['--md' as string]: meltDelay(b) },
      cls: cx(cmelt && 'is-melt', 'cell', 'lv-' + lvk, full ? 'm-full' : 'm-compact', !!b && full && b.h < 46 && 'is-dense', !!b && (b.w < 48 || b.h < 24) && 'is-mute', lvk === 'L4' && 'no-badge',
        !b && 'is-gone', all ? 'is-sel' : part && 'is-part', (s.hover === key || s.pinned === key) && 'is-hover', pend && 'is-pending', !!b && allDim && 'is-dim',
        !!s.drag && mem.some((m) => inRect[m]) && !mem.some((m) => hit[m]) && 'is-spared'),
      off: !b || pend, aria: nm + '，' + gb.toFixed(1) + ' GB' + (part ? '，已选 ' + onM.length + '/' + selM.length : '') + '，点击展开明细', pressed: undefined,
      full, compact: !full, solo: false, name: nm, l3: false,
      sizeText: part ? '已选\u00a0' + onM.length + '/' + selM.length + ' · ' + onGb.toFixed(1) + '\u00a0GB' : gb.toFixed(1) + (b && b.w < 110 ? 'G' : ' GB'),
      sizeShort: part ? onM.length + '/' + selM.length + ' · ' + onGb.toFixed(1) + 'G' : gb.toFixed(1) + 'G', szCls: cx('sz mono', part && 'st'),
      sel: all, part, mvTag: false, mvText: '', deco: null, decCls: 'dec',
      enter: () => { if (!sref.current.drag && sref.current.hover !== key) set({ hover: key }); },
      click: () => { if (isResults) set((p) => ({ pinned: p.pinned === key ? null : key })); },
      ctx: ctxHandler(key),
    });
  }));
  const sects = CATS.map((c) => {
    const b = lay.sects[c.id];
    const ids = c.items.filter((id) => its[id].v > 0.05);
    const rev = isScanning ? ids.filter((id) => !pending(id)) : ids;
    const gb = rev.reduce((a, id) => a + its[id].v, 0);
    const allDim = ids.length > 0 && ids.every((id) => dimFor(id));
    return {
      key: c.id, style: rectStyle(b, 'sect:' + c.id), cls: cx('sect', !b && 'is-gone', !!b && allDim && 'is-dim'), hcls: cx('sect-head', !!b && b.hh > 20 && 'two'),
      name: b ? b.label : c.name, off: !b, on: s.focusCat === c.id,
      gbText: isScanning && rev.length < ids.length ? (rev.length ? '≥' + Math.round(gb) + ' GB' : '统计中') : (gb >= 10 ? Math.round(gb) : gb.toFixed(1)) + ' GB',
      focus: () => set((p) => ({ focusCat: p.focusCat === c.id ? null : c.id, pinned: null })),
    };
  });

  // hover card (killed by any overlay / drag / scan)
  const cardId = s.pinned || s.hover;
  let hc: null | {
    cls: string; style: CSSProperties; pinned: boolean; sw: string; lvl: string; name: string; gbText: string; hint: string;
    leaf?: { hasAct: boolean; actLabel: string; pathHead: string; pathTail: string; note: string; canMove: boolean; moveGb: string };
    members?: { id: string; name: string; size: string; sw: string; canCheck: boolean; checked: boolean; locked: boolean }[];
  } = null;
  if (cardId && !ov && !s.drag && !isScanning && !isCleaning) {
    const isCl = cardId.startsWith('cl:');
    const b = isCl ? lay.clusters[cardId] : lay.cells[cardId];
    if (b && !(b.merged && !isCl) && b.w > 0) {
      const CW = 288, mem = isCl ? b.members! : [], CH = isCl ? 96 + 27 * mem.length : 200;
      let x: number, y: number, side: string, ay = 24, ax = 24;
      if (b.x + b.w + 12 + CW <= W) { x = b.x + b.w + 12; side = 'r'; }
      else if (b.x - 12 - CW >= 0) { x = b.x - 12 - CW; side = 'l'; }
      else { x = clamp(b.x + b.w / 2 - CW / 2, 0, W - CW); side = b.y + b.h + 12 + CH <= H ? 'b' : 't'; }
      if (side === 'r' || side === 'l') { y = clamp(b.y + b.h / 2 - 36, 0, Math.max(0, H - CH)); ay = clamp(b.y + b.h / 2 - y, 16, 110); }
      else { y = side === 'b' ? b.y + b.h + 12 : b.y - 12; ax = clamp(b.x + b.w / 2 - x, 16, CW - 16); }
      const base = { cls: cx('hc to-' + side, !!s.pinned && 'is-pinned'), style: { left: pc(x, W), top: pc(y, H), ['--ay' as string]: ay.toFixed(0) + 'px', ['--ax' as string]: ax.toFixed(0) + 'px' }, pinned: !!s.pinned };
      if (isCl) {
        const c = CATS.find((k) => k.id === cardId.split(':')[1])!, lv = b.lv!;
        hc = { ...base, sw: 'sw-' + lv, lvl: LVL[lv] + ' · ' + c.name + ' · 小项合并', name: (lv === 'L1' && c.cl ? c.cl : '其他') + ' ×' + mem.length,
          gbText: mem.reduce((a, m) => a + size(m), 0).toFixed(1) + ' GB', hint: s.pinned ? '勾选加入清理，点名称看详情' : '点击固定，逐项勾选',
          members: mem.map((m) => ({ id: m, name: LEAF[m].name, size: size(m).toFixed(1), sw: 'sw-' + level(m), canCheck: selectable(m), checked: !!checked[m], locked: !s.pinned })) };
      } else {
        const L = LEAF[cardId], lv = level(cardId), mm = L.move ? moveOf(L.move) : null;
        hc = { ...base, sw: 'sw-' + lv, lvl: LVL[lv], name: L.name,
          gbText: (lv === 'L2' && L.gain < size(cardId) - 0.05 ? '可腾出 ' + L.gain.toFixed(1) + ' / ' : '') + size(cardId).toFixed(1) + ' GB',
          hint: lv === 'L1' && selectable(cardId) ? '点击加入清理 · 右键更多' : '点击查看详情 · 右键更多',
          leaf: { hasAct: L.act !== 'keep' && selectable(cardId), actLabel: ALABEL[L.act], pathHead: L.pathHead, pathTail: L.pathTail, note: L.note, canMove: migratable(cardId), moveGb: mm ? moveGb(mm).toFixed(1) : '' } };
      }
    }
  }

  // detail drawer
  const dId = s.detail;
  const dt = dId && LEAF[dId] ? (() => {
    const L = LEAF[dId], lv = level(dId), mm = L.move ? moveOf(L.move) : null;
    return { L, sw: 'sw-' + lv, lvl: LVL[lv],
      gbText: (lv === 'L2' && L.gain < size(dId) - 0.05 ? '可腾出 ' + L.gain.toFixed(1) + ' / ' : '') + size(dId).toFixed(1) + ' GB',
      hasAct: L.act !== 'keep' && selectable(dId), canMove: migratable(dId) && s.moving !== L.move, moveGb: mm ? moveGb(mm).toFixed(1) : '', moveHow: mm ? mm.how : '',
      canSelect: selectable(dId) && isResults, selLabel: checked[dId] ? '移出清理' : lv === 'L1' ? '加入清理' : '确认并加入清理' };
  })() : null;

  // list groups
  const lvIds = (lv: MapLevel) => LEAVES.filter((l) => level(l.id) === lv && selectable(l.id)).map((l) => l.id);
  const l1 = lvIds('L1'), l2 = lvIds('L2'), l3 = lvIds('L3');
  const mvs = MOVES.filter((m) => moveGb(m) > 0.05);
  const keep = LEAVES.filter((l) => level(l.id) === 'L4' && size(l.id) > 0.05 && !migratable(l.id)).map((l) => l.id);
  const open = s.open || { L1: true, L2: false, L3: true, mv: false, keep: false };
  const sum = (ids: string[], f: (id: string) => number) => ids.reduce((a, id) => a + f(id), 0);
  const allOn = l1.length > 0 && l1.every((id) => checked[id]);
  type Group = { key: string; sw: string; arrow?: boolean; title: string; meta: string; kind: 'check' | 'move' | 'keep'; ids?: string[]; label?: boolean; emptyText: string; all?: () => void; allLabel?: string };
  let groups: Group[] = [
    { key: 'L1', sw: 'sw-L1', title: '可重建', meta: l1.length + ' 项 · ' + sum(l1, (id) => gain(id)).toFixed(1), kind: 'check', ids: l1, label: true, emptyText: '都清干净了',
      allLabel: allOn ? '全不选' : '全选', all: l1.length ? () => set((p) => ({ checked: { ...p.checked, ...Object.fromEntries(l1.map((id) => [id, !allOn])) } })) : undefined },
    { key: 'L2', sw: 'sw-L2', title: '需审阅', meta: l2.length + ' 项 · 约 ' + sum(l2, (id) => gain(id)).toFixed(1), kind: 'check', ids: l2, emptyText: '没有需要审阅的项' },
    { key: 'L3', sw: 'sw-L3', title: '不可恢复', meta: l3.length + ' 项 · ' + sum(l3, (id) => gain(id)).toFixed(1), kind: 'check', ids: l3, emptyText: '回收站是空的' },
    { key: 'mv', sw: 'sw-L4', arrow: true, title: '可迁移', meta: mvs.length + ' 项 · ' + mvs.reduce((a, m) => a + moveGb(m), 0).toFixed(1), kind: 'move', emptyText: '没有可迁移的项' },
    { key: 'keep', sw: 'sw-L4', title: '保留', meta: keep.length + ' 项 · ' + sum(keep, (id) => size(id)).toFixed(1), kind: 'keep', ids: keep, emptyText: '' },
  ];
  if (mode === 'move') groups = [groups[3], groups[0], groups[1], groups[2], groups[4]];
  const nSel = sel.length;
  const cgroups = SHOW_ORDER.map((a) => {
    const ids = sel.filter((id) => LEAF[id].act === a);
    return { a, sw: 'sw-' + (a === 'rebuild' ? 'L1' : a === 'empty' ? 'L3' : 'L2'), label: ALABEL[a], names: ids.map((id) => LEAF[id].name).join('、'), sum: ids.reduce((x, id) => x + gain(id), 0).toFixed(1) + ' GB', n: ids.length };
  }).filter((g) => g.n > 0);
  const run = s.run || { ids: [], amt: {}, freed: 0, bin: 0 };

  // ---- 30-day tide meter: smooth area curve, 87G reference, scrubbable cursor
  const used = TOTAL - freeNow, used30 = TOTAL - FREE30;
  const tvals = HIST30.concat([freeNow]), tN = tvals.length - 1, vmax = Math.max(92, freeNow + 6), vmin = 30;
  const tpy = (v: number) => 44 - (v - vmin) / (vmax - vmin) * 40 - 2, tpx = (i: number) => i / tN * 300;
  const tpts = tvals.map((v, i) => [tpx(i), tpy(v)]);
  let tline = 'M' + tpts[0][0].toFixed(1) + ' ' + tpts[0][1].toFixed(2);
  for (let i = 0; i < tpts.length - 1; i++) {
    const p0 = tpts[Math.max(0, i - 1)], p1 = tpts[i], p2 = tpts[i + 1], p3 = tpts[Math.min(tpts.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    tline += ' C' + c1[0].toFixed(1) + ' ' + c1[1].toFixed(2) + ' ' + c2[0].toFixed(1) + ' ' + c2[1].toFixed(2) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(2);
  }
  const tday = (i: number) => { const d = new Date(openedAt - (tN - i) * 86400000); return (d.getMonth() + 1) + '月' + String(d.getDate()).padStart(2, '0') + '日'; };
  const tdesc = (i: number) => { const v = tvals[i], dv = i > 0 ? v - tvals[i - 1] : 0;
    return tday(i) + ' · 可用 ' + v.toFixed(1) + 'G' + (TEV[i] ? ' · ' + TEV[i] : Math.abs(dv) >= 0.05 ? ' · 当日 ' + (dv > 0 ? '+' : '−') + Math.abs(dv).toFixed(1) + 'G' : ''); };
  const tc = s.tc === null ? null : clamp(s.tc, 0, tN);
  const setTc = (i: number | null) => { if (sref.current.tc !== i) set({ tc: i }); };
  let projText = '', projColor = 'var(--ink-2)';
  if (isResults && selFree > 0) { projText = '清理后 ' + (freeNow + selFree).toFixed(1); projColor = 'var(--tide)'; }
  if (isReport && run.freed > 0) { projText = '+' + run.freed.toFixed(1) + ' 已释放'; projColor = 'var(--tide)'; }
  const fi = Math.floor(freeNow + 1e-6), fd = Math.round((freeNow - fi) * 10) % 10;

  // migration dialog
  const mvO = ov === 'move' ? moveOf(s.moveId) : undefined;
  const mv = mvO ? (() => {
    const to = s.editing ? s.draft : target(mvO);
    const d = driveOf(to), info = drives.find((x) => x.id === d), g = moveGb(mvO), dfree = info ? driveFree(d) : 0;
    let err = '';
    if (!d) err = '请输入完整路径，例如 D:\\' + mvO.name;
    else if (d === sys.id) err = '目标仍在 ' + sys.id + ':，不会腾出空间';
    else if (!info) err = '找不到 ' + d + ':，请先连接这块磁盘';
    else if (dfree < g) err = d + ': 剩余空间不足';
    return { m: mvO, to: target(mvO), drive: d ? d + ':' : '新位置', gbText: g.toFixed(1), after: info ? (dfree - g).toFixed(0) : '—', err, steps: mvO.steps.map((t) => t.replace('{to}', to || '新位置')) };
  })() : null;

  const ctaN = dg ? dg.n + nSel - sel.filter((id) => hit[id]).length : nSel;
  const ctaGb = dg ? selFree + Object.keys(hit).filter((id) => !checked[id]).reduce((a, id) => a + gain(id), 0) : selFree;
  const atmo = atmoOf(shownFree, TOTAL);
  // remember where each block was drawn, so a block that disappears can collapse toward that spot
  const seenSig = Object.entries(seenNow).map(([k, b]) => k + ':' + b.x.toFixed(1) + ',' + b.y.toFixed(1) + ',' + b.w.toFixed(1) + ',' + b.h.toFixed(1)).join('|');
  useEffect(() => { set((p) => ({ seen: { ...p.seen, ...seenNow } })); }, [seenSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const mvTask = s.moving ? moveOf(s.moving) : null;

  // ---------- sync the shell (sidebar task slot, drive bars, suggest count)
  const owned = useRef(false);
  const taskKey = isScanning ? 's' + Math.round(s.p) : mvTask ? 'm' + s.mp + (s.paused ? 'p' : '') + s.movingTo : '';
  useEffect(() => {
    if (isScanning) {
      owned.current = true;
      setTask({ title: '扫描 C:', note: (s.p < 64 ? '索引文件系统' : '识别应用缓存') + '…', p: s.p, scan: true });
    } else if (mvTask) {
      owned.current = true;
      setTask({ title: '迁移 ' + mvTask.name + ' → ' + s.movingTo + ':', note: s.paused ? mvTask.name.split(' ')[0] + ' 正在运行，等待重试' : '可以继续使用电脑，完成后会通知你',
        p: s.mp, scan: false, meta: s.paused ? '暂停' : Math.round(s.mp) + '%', paused: s.paused, color: s.paused ? 'var(--accent)' : undefined });
    } else if (owned.current) { owned.current = false; setTask(null); }
  }, [taskKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setWriting(s.moving && !s.paused ? { [s.movingTo]: true } : {}); }, [s.moving, s.paused, s.movingTo, setWriting]);
  const suggestN = l1.length + l2.length + l3.length;
  useEffect(() => { setSuggestN(suggestN); }, [suggestN, setSuggestN]);
  useEffect(() => () => { void refreshDrives(); setWriting({}); if (owned.current) setTask(null); }, [refreshDrives, setWriting, setTask]);

  // ---------- marquee + splitter pointer handlers
  const mDown = (e: RPointerEvent<HTMLElement>) => {
    if (!isResults || s.confirm || ov || e.button !== 0) return;
    const t = e.target as Element;
    if (t.closest('.cell') || t.closest('.hc') || t.closest('.sect-head')) return;
    const r = e.currentTarget.getBoundingClientRect();
    mr.current = r;
    e.preventDefault(); // no text selection while drawing the marquee
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    set({ drag: { x0: x, y0: y, x1: x, y1: y }, pinned: null, hover: null });
  };
  const mMove = (e: RPointerEvent<HTMLElement>) => {
    const d = sref.current.drag, r = mr.current;
    if (!d || !r) return;
    set({ drag: { ...d, x1: clamp((e.clientX - r.left) / r.width, 0, 1), y1: clamp((e.clientY - r.top) / r.height, 0, 1) } });
  };
  const mUp = () => {
    const d = sref.current.drag;
    if (!d) return;
    mr.current = null;
    if (Math.abs(d.x1 - d.x0) < 0.01 && Math.abs(d.y1 - d.y0) < 0.01) { set({ drag: null, pinned: null, focusCat: null }); return; }
    set((p) => ({ drag: null, checked: { ...p.checked, ...Object.fromEntries(Object.keys(hit).map((id) => [id, true])) } }));
  };
  const unhover = () => { if (sref.current.hover) set({ hover: null }); };

  const setMode = (k: Mode) => {
    const o = k === 'move' ? { L1: false, L2: false, L3: false, mv: true, keep: false } : k === 'clean' ? { L1: true, L2: true, L3: true, mv: false, keep: false } : null;
    setPal(false);
    set({ mode: k, open: o });
  };

  // ---------- context menu
  const menu = ov === 'menu' && s.menu ? (() => {
    const { id, x, y, W: AW, H: AH } = s.menu;
    const its2: ({ sep: true } | { sep?: false; label: string; kb?: string; run: () => void; color?: string })[] = [];
    const add = (label: string, kb: string, fn: () => void, color?: string) => its2.push({ label, kb, run: fn, color });
    const sep = () => its2.push({ sep: true });
    const done = () => set({ overlay: null, menu: null });
    let title: string;
    if (id.startsWith('cl:')) {
      const c = lay.clusters[id];
      if (!c) return null;
      const sl = c.members!.filter((m) => selectable(m));
      title = '其他 ×' + c.members!.length + ' · ' + c.members!.reduce((a, m) => a + size(m), 0).toFixed(1) + ' GB';
      add('展开明细', 'Enter', () => set({ overlay: null, menu: null, pinned: id }));
      if (sl.length) add('全部加入清理', '', () => set((p) => ({ checked: { ...p.checked, ...Object.fromEntries(sl.map((m) => [m, true])) }, overlay: null, menu: null })));
    } else {
      const L = LEAF[id];
      title = L.name + ' · ' + size(id).toFixed(1) + ' GB';
      if (selectable(id)) add(checked[id] ? '移出清理' : '加入清理', '空格', () => { toggle(id); done(); });
      add('查看详情', 'Enter', () => openDetail(id));
      if (migratable(id) && s.moving !== L.move) add('迁移…', '', () => openMove(L.move));
      sep();
      add('打开所在位置', 'Ctrl O', () => { done(); pushToast({ kind: 'ok', title: '已在资源管理器中打开', sub: L.pathHead + L.pathTail }, 3000); });
      add('复制路径', 'Ctrl Shift C', () => { done(); navigator.clipboard?.writeText(L.pathHead + L.pathTail).catch(() => { /* blocked */ }); pushToast({ kind: 'ok', title: '路径已复制' }, 2500); });
      if (selectable(id)) {
        sep();
        add('忽略这一项', '', () => {
          const ck = { ...checked }; delete ck[id];
          set({ ignored: { ...s.ignored, [id]: true }, checked: ck, overlay: null, menu: null });
          pushToast({ kind: 'ok', title: '已忽略「' + L.name + '」', sub: '以后不再建议清理它', action: '撤销',
            run: () => set((p) => { const ig = { ...p.ignored }; delete ig[id]; return { ignored: ig }; }) }, 6000);
        }, 'var(--accent)');
      }
    }
    return { title, items: its2, x: clamp(x, 8, AW - 250) + 'px', y: clamp(y, 8, AH - its2.length * 34 - 48) + 'px' };
  })() : null;

  // ---------- render
  const segItems: [Mode, string][] = [['all', '全部'], ['clean', '可清理'], ['move', '可迁移']];
  const rowCls = (id: string) => cx('row', s.hover === id && 'is-hover', hit[id] && 'is-pre');
  const rowSize = (id: string) => (LEAF[id].level === 'L2' ? LEAF[id].gain : size(id)).toFixed(1);

  return (
    <Shell path={PATHS.map} palette={<MapPalette checked={checked} leaves={LEAVES} cats={CATS} moves={MOVES} sysId={sys.id} set={set} close={() => setPal(false)} level={level} size={size} selectable={selectable} moveGb={moveGb}
      setMode={setMode} rescan={() => void rescan()} openDetail={openDetail} openMove={openMove} openBell={() => openOverlay('bell')} />}>
      <div className="hdr">
        <nav aria-label="位置" className="crumb"><span className="muted">{s.model ? model.drive.id + ': ' + model.drive.name : sys.id + ': ' + sys.name}</span><span className="muted" aria-hidden="true">/</span><span>空间地图</span></nav>
        <Seg label="地图显示" value={mode} onPick={setMode} items={segItems} />
        <span style={{ flex: '1 1 auto' }} />
        <span className={'atmo-tag t-' + atmo} role="status"><i aria-hidden="true" />{ATMO_TEXT[atmo]}</span>
        <div className="legend" aria-label="图例"><span><span className="sw10 sw-L1" />可重建</span><span><span className="sw10 sw-L2" />需审阅</span><span><span className="sw10 sw-L3" />不可恢复</span><span><span className="sw10 sw-L4" />保留</span></div>
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="空间提醒" aria-expanded={ov === 'bell'} onClick={() => (ov === 'bell' ? closeOverlay() : openOverlay('bell'))} style={{ padding: '0.3125rem' }}><Icon name="i14" size={15} /></button>
          {ov === 'bell' && (
            <section className="pop" aria-label="空间提醒">
              <div style={{ display: 'flex', alignItems: 'center', padding: '0.75rem 1rem', borderBottom: '1px solid var(--line)' }}>
                <span style={{ fontWeight: 600 }}>空间提醒</span><span style={{ flex: '1 1 auto' }} />
                <button type="button" className="btn btn-ghost btn-sm" aria-label="关闭" onClick={closeOverlay} style={{ padding: '0.25rem' }}><Icon name="i15" size={12} /></button>
              </div>
              {([['low', 'C: 少于 20 GB 时提醒我', '通知里直接给出可腾出多少'], ['weekly', '每周日自动清理「可重建」项', '不碰回收站、系统设置和你的文件'], ['inst', '安装包装好后提醒我放进回收站', '只看「下载」文件夹']] as const).map(([k, name, sub]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.625rem 1rem', borderBottom: '1px solid var(--line)' }}>
                  <span style={{ flex: '1 1 auto', display: 'grid' }}><label htmlFor={'rem-' + k} style={{ color: 'var(--ink)' }}>{name}</label><span className="muted" style={{ fontSize: '0.6875rem' }}>{sub}</span></span>
                  <span className="tgl"><input id={'rem-' + k} type="checkbox" role="switch" className="tgl-in" checked={!!s.rem[k]} onChange={() => set((p) => ({ rem: { ...p.rem, [k]: !p.rem[k] } }))} /><span className="tgl-tr" aria-hidden="true" /><span className="tgl-kn" aria-hidden="true" /></span>
                </div>
              ))}
              <div className="muted" style={{ padding: '0.625rem 1rem', fontSize: '0.6875rem' }}>通过 Windows 通知中心提醒</div>
            </section>
          )}
        </span>
        <button type="button" className="btn btn-sm" onClick={() => void rescan()} disabled={isScanning || isCleaning}><Icon name="rescan" size={14} />重新扫描</button>
      </div>

      <div style={{ position: 'relative', flex: '1 1 auto', minBlockSize: 0, display: 'flex', gap: '1.25rem', padding: '1.25rem' }}>
        <section aria-label="空间摘要" className="mid" style={{ flex: '0 0 ' + s.lw + 'px' }}>
          <div>
            <div className="hero-row">
              <span className="hero-num num anim" role="img" aria-label={freeNow.toFixed(1) + ' GB 可用'} style={{ ['--i' as string]: fi, ['--dd' as string]: fd }} />
              <span className="hero-cap">GB 可用<br /><span className="mono" style={{ color: projColor }}>{projText}</span></span>
            </div>
            <div className="tm" tabIndex={0} role="slider" aria-label="近 30 天可用空间" aria-valuemin={0} aria-valuemax={29} aria-valuenow={tc ?? tN} aria-valuetext={tdesc(tc ?? tN)}
              onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (r.width > 0) setTc(Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * tN)); }}
              onPointerLeave={() => setTc(null)} onBlur={() => setTc(null)}
              onKeyDown={(e) => {
                const cur = sref.current.tc ?? tN;
                if (e.key === 'ArrowLeft') { e.preventDefault(); setTc(Math.max(0, cur - 1)); }
                else if (e.key === 'ArrowRight') { e.preventDefault(); setTc(Math.min(tN, cur + 1)); }
                else if (e.key === 'Home') { e.preventDefault(); setTc(0); }
                else if (e.key === 'End') { e.preventDefault(); setTc(tN); }
                else if (e.key === 'Escape') setTc(null);
              }}>
              <svg className="tm-svg" viewBox="0 0 300 44" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="tm19a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3C7375" stopOpacity=".34" /><stop offset="1" stopColor="#C23B2B" stopOpacity=".22" /></linearGradient>
                  <linearGradient id="tm19l" gradientUnits="userSpaceOnUse" x1="0" y1="2" x2="0" y2="42"><stop offset="0" stopColor="#3C7375" /><stop offset="1" stopColor="#C23B2B" /></linearGradient>
                </defs>
                <path d={tline + ' L300 44 L0 44 Z'} fill="url(#tm19a)" />
                <path d={tline} fill="none" stroke="url(#tm19l)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              </svg>
              <span className="tm-ref" style={{ top: (tpy(FREE30) / 44 * 100).toFixed(2) + '%' }} aria-hidden="true"><span className="mono">30 天前 {Math.round(tvals[0])}G</span></span>
              {tc !== null && <>
                <span className="tm-cur" style={{ left: (tc / tN * 100).toFixed(2) + '%' }} aria-hidden="true" />
                <span className="tm-dot" style={{ left: (tc / tN * 100).toFixed(2) + '%', top: (tpy(tvals[tc]) / 44 * 100).toFixed(2) + '%' }} aria-hidden="true" />
              </>}
            </div>
            <div className="tm-cap" aria-hidden="true"><span className={cx('tm-t', tc === null && 'on')}>30天前 {Math.round(tvals[0])}G → 今日 {Math.round(freeNow)}G</span><span className={cx('tm-t mono', tc !== null && 'on')}>{tc === null ? '' : tdesc(tc)}</span></div>
            <div className="capbar" role="img" aria-label={`${sys.id}: 已用 ${used.toFixed(1)} GB，共 ${Math.round(TOTAL)} GB；30 天前已用 ${Math.round(TOTAL - FREE30)} GB`}>
              <span className="cb-used" style={{ flex: '0 0 ' + pc(Math.max(0, used - selFree), TOTAL) }} /><span className="cb-gain" style={{ flex: '0 0 ' + pc(selFree, TOTAL) }} /><span className="cb-tide" style={{ left: pc(used30, TOTAL) }} />
            </div>
            <div className="cb-cap"><span className="mono">已用 {used.toFixed(1)} / {Math.round(TOTAL)} GB</span><span className="tide"><i />30 天前</span></div>
          </div>

          {isResults && !spot && <>
            <div className="sbw" style={{ flex: '1 1 auto', marginBlockStart: '1rem' }}>
              <div className="list sbs" aria-label="清理与迁移清单">
                {groups.map((g) => {
                  const isOpen = !!open[g.key];
                  const rowsN = g.kind === 'move' ? mvs.length : g.ids!.length;
                  return (
                    <div key={g.key}>
                      <div className="grp">
                        <button type="button" className="grp-tog" aria-expanded={isOpen} onClick={() => set({ open: { ...open, [g.key]: !isOpen } })}>
                          <span className="chev"><Icon name="chevronDown" size={12} /></span>
                          {g.arrow ? <span className="g-arrow" aria-hidden="true">↗</span> : <span className={'sw10 ' + g.sw} />}
                          <span className="gt">{g.title}</span><span className="mono">{g.meta}</span>
                        </button>
                        {g.all && <button type="button" className="btn btn-ghost btn-sm" onClick={g.all} style={{ color: 'var(--ink)' }}>{g.allLabel}</button>}
                      </div>
                      {isOpen && <>
                        {g.kind === 'check' && g.ids!.map((id) => g.label ? (
                          <label key={id} className={rowCls(id)} onMouseEnter={() => set({ hover: id })} onMouseLeave={unhover} onContextMenu={ctxHandler(id)}>
                            <span className="cbx"><input type="checkbox" className="cbx-in" checked={!!checked[id]} onChange={() => toggle(id)} /><span className="cbx-box" aria-hidden="true"><Icon name="check" size={10} /></span></span>
                            <span className="nm">{LEAF[id].name}</span><span className="mono">{rowSize(id)}</span>
                          </label>
                        ) : (
                          <div key={id} className={rowCls(id)} onMouseEnter={() => set({ hover: id })} onMouseLeave={unhover} onContextMenu={ctxHandler(id)}>
                            <span className="cbx"><input type="checkbox" className="cbx-in" aria-label={LEAF[id].name} checked={!!checked[id]} onChange={() => toggle(id)} /><span className="cbx-box" aria-hidden="true"><Icon name="check" size={10} /></span></span>
                            <button type="button" className="lnk" onClick={() => openDetail(id)}><span className="nm">{LEAF[id].name}</span>{level(id) === 'L3' && <span className="l3tag">不可恢复</span>}</button>
                            <span className="mono">{rowSize(id)}</span>
                          </div>
                        ))}
                        {g.kind === 'move' && mvs.map((m) => (
                          <div key={m.id} className={cx('row', m.cells.includes(s.hover ?? '') && 'is-hover')} onMouseEnter={() => set({ hover: m.cells[0] })} onMouseLeave={unhover} onContextMenu={ctxHandler(m.cells[0])}>
                            <span className="nm">{m.name}</span><span className="mono">{moveGb(m).toFixed(1)}</span>
                            <button type="button" className="btn btn-sm" disabled={!!s.moving} onClick={() => openMove(m.id)}>{s.moving === m.id ? (s.paused ? '已暂停' : Math.round(s.mp) + '%') : '迁移…'}</button>
                          </div>
                        ))}
                        {g.kind === 'keep' && g.ids!.map((id) => (
                          <button key={id} type="button" className={rowCls(id)} onMouseEnter={() => set({ hover: id })} onMouseLeave={unhover} onClick={() => openDetail(id)} onContextMenu={ctxHandler(id)}>
                            <span className="nm">{LEAF[id].name}</span><span className="mono">{rowSize(id)}</span>
                          </button>
                        ))}
                        {rowsN === 0 && g.emptyText && <div className="muted" style={{ padding: '0.5rem 0 0.75rem 1.625rem', fontSize: '0.75rem' }}>{g.emptyText}</div>}
                      </>}
                    </div>
                  );
                })}
              </div>
              <i className="sbt" aria-hidden="true" />
            </div>
            <div className="cta">
              <button type="button" className={dg ? 'btn cta-pre' : 'btn btn-primary'} disabled={nSel === 0 && !dg} onClick={() => set({ confirm: true, overlay: null, dOpen: false, pinned: null, hover: null })}>
                {dg ? (dg.n ? '松开以加入 ' + dg.n + ' 项 · ' + dg.gb.toFixed(1) + ' GB' : '框选只会选中「可重建」项')
                  : !ctaN ? '清理' : ctaGb > 0.05 ? '清理 ' + ctaN + ' 项 · 释放 ' + ctaGb.toFixed(1) + ' GB' : '清理 ' + ctaN + ' 项 · 移入回收站 ' + selBin.toFixed(1) + ' GB'}
              </button>
              {selBin > 0 && ctaGb > 0.05 && !dg && <span className="cta-note">另有 {selBin.toFixed(1)} GB 移入回收站，清空后释放</span>}
            </div>
          </>}

          {spot && <>
            <section aria-labelledby="r7-cf" style={{ display: 'grid', gap: '0.75rem', marginTop: '1.5rem', alignContent: 'start' }}>
              <h2 id="r7-cf" style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>清理 {nSel} 项？</h2>
              <dl style={{ margin: 0 }}>
                <div className="rc-row"><dt>将释放磁盘空间</dt><dd className="mono" style={{ fontSize: '0.9375rem', fontWeight: 500 }}>{selFree.toFixed(1)} GB</dd></div>
                {selBin > 0 && <div className="rc-row"><dt>将移入回收站<span className="muted" style={{ fontSize: '0.75rem' }}>（清空后释放）</span></dt><dd className="mono">{selBin.toFixed(1)} GB</dd></div>}
              </dl>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid' }}>
                {cgroups.map((g) => <li key={g.a} className="grow"><span className={'sw10 ' + g.sw} /><span style={{ display: 'grid', minInlineSize: 0 }}><span>{g.label}</span><span className="muted ellipsis" style={{ fontSize: '0.6875rem' }}>{g.names}</span></span><span className="mono" style={{ fontSize: '0.75rem' }}>{g.sum}</span></li>)}
              </ul>
              {sel.some((id) => LEAF[id].act === 'empty') && <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--accent)' }}>清空回收站后，里面的文件无法找回。</p>}
            </section>
            <div style={{ flex: '1 1 auto' }} />
            <div className="cta" style={{ gridTemplateColumns: '1fr 1fr', display: 'grid', gap: '0.5rem' }}>
              <button type="button" className="btn" autoFocus onClick={() => set({ confirm: false })}>取消</button>
              <button type="button" className="btn btn-primary" onClick={runClean}>清理</button>
            </div>
          </>}

          {isScanning && <>
            <div style={{ marginTop: '1.5rem', display: 'grid', gap: '0.25rem' }}>
              <span className="bar" style={{ blockSize: '0.25rem' }} aria-hidden="true"><span style={{ inlineSize: s.p.toFixed(0) + '%' }} /></span>
              <ol aria-label="扫描步骤" style={{ listStyle: 'none', margin: '0.5rem 0 0', padding: 0, display: 'grid' }}>
                {([['索引文件系统', 0, 64, '已索引 41.2 万个文件'], ['识别应用缓存', 64, 100, '按路径与文件类型匹配 230 条规则']] as const).map(([name, a, b, sub]) => {
                  const done = s.p >= b, active = s.p >= a && s.p < b;
                  return (
                    <li key={name} className="stp">
                      {done ? <span className="dot-done"><Icon name="check" size={10} /></span> : active ? <span className="spin" aria-label="进行中" /> : <span className="dot-wait" />}
                      <span style={{ display: 'grid' }}><span style={{ fontWeight: active ? 600 : 400 }}>{name}</span><span className="muted" style={{ fontSize: '0.6875rem' }}>{sub}</span></span>
                      <span className="mono muted" style={{ fontSize: '0.75rem' }}>{done ? '完成' : active ? Math.round((s.p - a) / (b - a) * 100) + '%' : ''}</span>
                    </li>
                  );
                })}
              </ol>
              <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>已发现 <span className="mono" style={{ color: 'var(--ink)' }}>{found.n}</span> 项 · <span className="mono" style={{ color: 'var(--ink)' }}>{found.gb.toFixed(1)}</span> GB</div>
            </div>
            <div style={{ display: 'grid', gap: '0.875rem', marginTop: '1.25rem' }} aria-hidden="true">
              {[62, 48, 70, 40, 56].map((w) => <div key={w} style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}><span className="skel" style={{ inlineSize: '1rem', blockSize: '1rem' }} /><span className="skel" style={{ inlineSize: w + '%' }} /><span style={{ flex: '1 1 auto' }} /><span className="skel" style={{ inlineSize: '2.25rem' }} /></div>)}
            </div>
            <div style={{ flex: '1 1 auto' }} />
            <div className="cta"><button type="button" className="btn" onClick={stopScan}>停止扫描</button></div>
          </>}

          {isCleaning && <>
            <div style={{ marginTop: '1.5rem' }}><span className="bar" style={{ blockSize: '0.25rem' }} aria-hidden="true"><span style={{ inlineSize: (s.queue.length ? (s.qi + s.step / 3) / s.queue.length * 100 : 0).toFixed(0) + '%' }} /></span></div>
            <ol style={{ listStyle: 'none', margin: '0.75rem 0 0', padding: 0, display: 'grid' }}>
              {s.queue.map((id, i) => {
                const done = i < s.qi, active = i === s.qi;
                return (
                  <li key={id} className="stp" style={{ borderBlockStart: '1px solid var(--line)' }}>
                    {done ? <span className="dot-done"><Icon name="check" size={10} /></span> : active ? <span className="spin" aria-label="进行中" /> : <span className="dot-wait" />}
                    <span style={{ display: 'grid', minInlineSize: 0 }}><span className="ellipsis">{LEAF[id].name}</span><span className="muted ellipsis" style={{ fontSize: '0.6875rem' }}>{active ? ['正在确认相关程序没有运行…', '正在执行…', '正在重新测量…'][s.step] : done ? ALABEL[LEAF[id].act] : ''}</span></span>
                    <span className="mono muted" style={{ fontSize: '0.75rem' }}>{(done && s.run ? s.run.amt[id] : gain(id)).toFixed(1)}</span>
                  </li>
                );
              })}
            </ol>
            <div style={{ flex: '1 1 auto' }} />
          </>}

          {isReport && <>
            <div className="sbw" style={{ flex: '0 1 auto', marginTop: '1.5rem', ['--sbh' as string]: '48px' }}>
              <section className="sbs" aria-label="清理收据" style={{ display: 'grid', alignContent: 'start', minBlockSize: 0, overflowY: 'auto' }}>
                <div className="muted" style={{ fontSize: '0.75rem' }}>清理完成 · {hhmm()} 重新测量</div>
                <dl style={{ margin: '0.5rem 0 0.75rem' }}>
                  <div className="rc-row"><dt>已释放磁盘空间</dt><dd className="mono" style={{ fontSize: '1.25rem', fontWeight: 500, color: 'var(--tide)' }}>{run.freed.toFixed(1)} GB</dd></div>
                  {run.freed >= 0.5 && <p className="rc-human">{(() => { const f = run.freed, n7 = Math.floor(f / 4.4), days = Math.round(f / (43.2 / 30)); return (n7 >= 1 ? '够再装 ' + n7 + ' 个 7B 本地模型（每个约 4.4 GB），' : '') + '约抵消 C: 过去 ' + days + ' 天的空间增长'; })()}</p>}
                  {run.bin > 0.05 && <div className="rc-row"><dt>已移入回收站<span className="muted" style={{ fontSize: '0.75rem' }}>（清空后释放）</span></dt><dd className="mono">{run.bin.toFixed(1)} GB</dd></div>}
                </dl>
                {run.ids.map((id) => {
                  const a = LEAF[id].act, und = !!s.undone[id];
                  return (
                    <div key={id} className="rc-item">
                      <span className={'sw10 sw-' + LEAF[id].level} />
                      <span style={{ display: 'grid', minInlineSize: 0 }}><span className="ellipsis">{LEAF[id].name}</span><span className="muted ellipsis" style={{ fontSize: '0.6875rem' }}>{und ? '已' + (a === 'setting' ? '还原' : '撤销') : ALABEL[a] + (id === 'temp' ? ' · 跳过 3 个正在使用的文件' : '')}</span></span>
                      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.625rem' }}>
                        <span className="mono" style={{ fontSize: '0.75rem' }}>{und ? '—' : run.amt[id].toFixed(1)}</span>
                        {(a === 'recycle' || a === 'setting') && !und && <button type="button" className="link-btn" style={{ fontSize: '0.75rem' }} onClick={() => void undo(id)}>{a === 'setting' ? '还原' : '撤销'}</button>}
                      </span>
                    </div>
                  );
                })}
              </section>
              <i className="sbt" aria-hidden="true" />
            </div>
            <div style={{ flex: '1 1 auto' }} />
            <div className="cta" style={{ gridTemplateColumns: '1fr auto', display: 'grid', gap: '0.5rem' }}>
              <button type="button" className="btn btn-primary" autoFocus onClick={() => set({ phase: 'results', queue: [], qi: 0, run: null, undone: {} })}>完成</button>
              <a className="btn btn-ghost" href={'#' + PATHS.activity}>查看活动</a>
            </div>
          </>}
        </section>

        <button type="button" className={cx('split', splitting && 'on')} aria-label="拖动或用方向键调整左栏宽度"
          onPointerDown={(e) => { split.current = { x: e.clientX, w: s.lw }; e.currentTarget.setPointerCapture?.(e.pointerId); setSplitting(true); }}
          onPointerMove={(e) => { if (!split.current) return; const w = clamp(split.current.w + e.clientX - split.current.x, 280, 440); if (w !== sref.current.lw) set({ lw: w }); }}
          onPointerUp={() => { split.current = null; setSplitting(false); }}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') set((p) => ({ lw: clamp(p.lw - 16, 280, 440) })); if (e.key === 'ArrowRight') set((p) => ({ lw: clamp(p.lw + 16, 280, 440) })); }} />

        <section aria-label="空间地图" className={cx('map', s.ebb === 'grow' && 'is-ebb', isScanning && 'is-scanning')} ref={mapEl}
          onPointerDown={mDown} onPointerMove={mMove} onPointerUp={mUp} onMouseLeave={unhover}>
          <div className="free" style={{ left: '0%', top: '0%', width: '100%', height: pc(lay.free.h, H) }}>
            <svg className="free-iso" aria-hidden="true" viewBox="0 0 1000 100" preserveAspectRatio="none"><path d="M0 24 C 150 15, 330 33, 510 22 S 850 13, 1000 25" /><path d="M0 51 C 190 42, 370 60, 560 49 S 870 41, 1000 53" /><path d="M0 77 C 140 70, 340 86, 530 75 S 840 68, 1000 79" /></svg>
            {!isScanning && freeNow > FREE0 + 0.05 && lay.free.h - Math.max(28, H * FREE0 / TOTAL) > 8 && (
              <div className="free-old" style={{ top: (Math.max(28, H * FREE0 / TOTAL) / lay.free.h * 100).toFixed(2) + '%' }}><span className="mono">清理前 {FREE0.toFixed(1)}G</span></div>
            )}
            <div className="free-lab mono">空闲 · {freeNow.toFixed(1)}G{isReport && run.freed > 0 && <span className="tide"><span>+{run.freed.toFixed(1)}</span></span>}</div>
          </div>
          {sects.map((k) => (
            <div key={k.key} className={k.cls} style={k.style}>
              <button type="button" className={k.hcls} aria-pressed={k.on} onClick={k.focus} disabled={k.off}><b>{k.name}</b><span className="mono">{k.gbText}</span></button>
            </div>
          ))}
          {blocks.map((c) => (
            <button key={c.key} type="button" className={c.cls} style={c.style} aria-label={c.aria} aria-pressed={c.pressed} disabled={c.off}
              onMouseEnter={c.enter} onFocus={c.enter} onClick={c.click} onContextMenu={c.ctx}>
              {c.full && <><span className="nm-row"><span className="nm">{c.name}</span>{c.l3 && <span className="l3tag">不可恢复</span>}</span><span className="sz-row"><span className={c.szCls}>{c.sizeText}</span>{c.mvTag && <span className="mv2" aria-hidden="true">{c.mvText}</span>}</span></>}
              {c.compact && <span className="ln"><span className="nm">{c.name}</span>{c.l3 && <span className="l3tag">不可恢复</span>}<span className={c.szCls}>{c.sizeShort}</span>{c.mvTag && <span className="mv2" aria-hidden="true">↗</span>}</span>}
              {c.solo && <><span className="solo mono">{c.sizeText}</span>{c.mvTag && <span className="mv2" aria-hidden="true">↗ 迁移</span>}</>}
              {c.deco && <svg className={c.decCls} viewBox="0 0 48 48" aria-hidden="true" focusable="false">{DECO[c.deco]}</svg>}
              {c.sel && <span className="ck"><Icon name="check" size={10} /></span>}
              {c.part && <span className="ck ck-part" aria-hidden="true"><i /></span>}
            </button>
          ))}
          {s.focusCat && !dg && (
            <button type="button" className="focus-chip" onClick={() => set({ focusCat: null })} aria-label={'退出仅看 ' + CATS.find((k) => k.id === s.focusCat)?.name + '，恢复全部'}>
              <span className="fc-t">仅看<span className="fc-c">：</span>{CATS.find((k) => k.id === s.focusCat)?.name}</span>
              <span className="fc-x" aria-hidden="true"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 2l6 6M8 2l-6 6" /></svg></span>
            </button>
          )}
          {dg && <><div className="marq" style={{ left: dg.l, top: dg.t, width: dg.w, height: dg.h }} /><span className="marq-tag" style={{ left: dg.tl, top: dg.tt }}>{dg.label}</span></>}
          {(s.ebb === 'wave' || s.ebb === 'grow') && <div className="ebb-wave" aria-hidden="true"><i /></div>}
          {isScanning && <div className="scan-beam" style={{ top: s.p.toFixed(1) + '%' }} aria-hidden="true"><i /></div>}
          {hc && (
            <div className={hc.cls} style={hc.style} aria-live="polite">
              <div className="hc-top"><span className={'sw10 ' + hc.sw} /><span className="muted">{hc.lvl}</span><span style={{ flex: '1 1 auto' }} />
                {hc.pinned && <button type="button" className="btn btn-ghost btn-sm" aria-label="关闭" onClick={() => set({ pinned: null })} style={{ padding: '0.125rem', minBlockSize: '1.375rem' }}><Icon name="i19" size={12} /></button>}
              </div>
              <div className="hc-name"><b>{hc.name}</b><span className="mono muted">{hc.gbText}</span></div>
              {hc.leaf && <>
                {hc.leaf.hasAct && <span className="act">{hc.leaf.actLabel}</span>}
                <div className="path"><span>{hc.leaf.pathHead}</span><span>{hc.leaf.pathTail}</span></div>
                {hc.leaf.note && <p style={{ margin: 0, lineHeight: 1.55, textWrap: 'pretty', color: 'var(--ink-2)' }}>{hc.leaf.note}</p>}
                {hc.leaf.canMove && <span className="act">↗ 可迁移到其他磁盘 · <span className="mono">{hc.leaf.moveGb} GB</span></span>}
              </>}
              {hc.members && <div style={{ display: 'grid' }}>
                {hc.members.map((m) => (
                  <div key={m.id} className="hc-mem">
                    {m.canCheck ? <Cbx label={m.name} checked={m.checked} disabled={m.locked} onChange={() => toggle(m.id)} /> : <span style={{ inlineSize: '1rem' }} />}
                    <span className={'sw10 ' + m.sw} />
                    <button type="button" className="link-btn ellipsis" style={{ color: 'var(--ink)', textDecoration: 'none', textAlign: 'start' }} onClick={() => openDetail(m.id)}>{m.name}</button>
                    <span className="mono muted">{m.size}</span>
                  </div>
                ))}
              </div>}
              <span className="muted" style={{ fontSize: '0.6875rem' }}>{hc.hint}</span>
            </div>
          )}
        </section>

        <aside className={cx('drawer', s.dOpen && !!dId && 'open')} aria-label="详情" aria-hidden={!s.dOpen} inert={!s.dOpen}>
          {dt && (
            <div className="sbw" style={{ flex: '1 1 auto' }}><div className="drawer-in sbs">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className={'sw10 ' + dt.sw} /><span className="muted" style={{ fontSize: '0.75rem' }}>{dt.lvl} · {dt.L.catName}</span><span style={{ flex: '1 1 auto' }} />
                <button type="button" className="btn btn-ghost btn-sm" aria-label="关闭详情" onClick={closeOverlay} style={{ padding: '0.25rem' }}><Icon name="i20" size={12} /></button>
              </div>
              <div style={{ display: 'grid', gap: '0.25rem' }}><h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.35 }}>{dt.L.name}</h2><span className="mono" style={{ fontSize: '0.875rem', color: 'var(--ink-2)' }}>{dt.gbText}</span></div>
              {dt.hasAct && <span className="act" style={{ color: 'var(--ink)' }}><span className={'sw10 ' + dt.sw} />{ALABEL[dt.L.act]}</span>}
              {dt.L.note && <p style={{ margin: 0, lineHeight: 1.65, textWrap: 'pretty' }}>{dt.L.note}</p>}
              {dt.L.meta && <span className="muted" style={{ fontSize: '0.6875rem' }}>本地元数据识别 · 不读取文件内容</span>}
              <div className="path"><span>{dt.L.pathHead}</span><span>{dt.L.pathTail}</span></div>
              {dt.canMove && (
                <div style={{ border: '1px solid var(--line-2)', borderRadius: 6, padding: '0.625rem 0.75rem', display: 'grid', gap: '0.25rem', background: 'var(--paper)' }}>
                  <span>↗ 也可以迁移到其他磁盘 · <span className="mono">{dt.moveGb} GB</span></span><span className="muted" style={{ fontSize: '0.75rem' }}>{dt.moveHow}</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {dt.canSelect && <button type="button" className="btn btn-primary btn-sm" onClick={() => toggle(dt.L.id)}>{dt.selLabel}</button>}
                {dt.canMove && <button type="button" className="btn btn-sm" onClick={() => openMove(dt.L.move)}>迁移…</button>}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => pushToast({ kind: 'ok', title: '已在资源管理器中打开', sub: dt.L.pathHead + dt.L.pathTail }, 3000)}><Icon name="i21" size={13} />打开所在位置</button>
              </div>
              {dt.L.cmd && (
                <details><summary className="muted" style={{ cursor: 'pointer', fontSize: '0.75rem' }}>高级 · PowerShell 等效命令</summary>
                  <pre className="mono" style={{ margin: '0.375rem 0 0', fontSize: '0.6875rem', lineHeight: 1.6, background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 6, padding: '0.375rem 0.5rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{dt.L.cmd}</pre>
                </details>
              )}
            </div><i className="sbt" aria-hidden="true" /></div>
          )}
        </aside>
      </div>
      <Toasts bottom="1rem" />

      {ov === 'bell' && <AppPortal><button type="button" className="veil" style={{ zIndex: 3 }} aria-label="关闭提醒" onClick={closeOverlay} /></AppPortal>}
      {menu && (
        <AppPortal>
          <button type="button" className="veil" aria-label="关闭菜单" onClick={closeOverlay} onContextMenu={(e) => { e.preventDefault(); closeOverlay(); }} />
          <div className="menu" role="menu" aria-label={menu.title} style={{ left: menu.x, top: menu.y }}>
            <div className="muted ellipsis" style={{ fontSize: '0.6875rem', padding: '0.375rem 0.625rem 0.25rem' }}>{menu.title}</div>
            {menu.items.map((i, k) => i.sep
              ? <div key={k} className="menu-sep" role="separator" />
              : <button key={k} type="button" role="menuitem" className="menu-item" style={{ color: i.color ?? 'var(--ink)' }} onClick={i.run}>{i.label}<span className="kb">{i.kb}</span></button>)}
          </div>
        </AppPortal>
      )}
      {mv && (
        <Modal onClose={closeOverlay}>
          <section className="dlg" role="dialog" aria-modal="true" aria-labelledby="r7-mv">
            <h2 id="r7-mv" style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>将「{mv.m.name}」迁移至 {mv.drive}</h2>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '3.5rem minmax(0, 1fr)', gap: '0.5rem', alignItems: 'center' }}><span className="muted" style={{ fontSize: '0.75rem' }}>现在</span><span className="path" style={{ color: 'var(--ink)' }}><span>{mv.m.frm}</span></span></div>
              <div style={{ display: 'grid', gridTemplateColumns: '3.5rem minmax(0, 1fr)', gap: '0.5rem', alignItems: 'center' }}><span className="muted" style={{ fontSize: '0.75rem' }}>迁移到</span>
                {s.editing ? (
                  <span style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', minInlineSize: 0 }}>
                    <label htmlFor="r7-to" className="vh">新位置</label>
                    <input id="r7-to" className="inline-in" autoFocus value={s.draft} onChange={(e) => set({ draft: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); set((p) => ({ toEdits: { ...p.toEdits, [p.moveId!]: p.draft }, editing: false })); }
                        if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); set({ editing: false }); }
                      }} />
                    <button type="button" className="btn btn-primary btn-sm" aria-label="确定" onClick={() => set((p) => ({ toEdits: { ...p.toEdits, [p.moveId!]: p.draft }, editing: false }))} style={{ padding: '0.25rem 0.5rem' }}>✓</button>
                    <button type="button" className="btn btn-ghost btn-sm" aria-label="取消修改" onClick={() => set({ editing: false })} style={{ padding: '0.25rem 0.5rem' }}>✕</button>
                  </span>
                ) : (
                  <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minInlineSize: 0 }}>
                    <span className="path" style={{ color: 'var(--ink)' }}><span>{mv.to}</span></span>
                    <button type="button" className="link-btn" style={{ fontSize: '0.75rem', color: 'var(--ink-2)' }} onClick={() => set({ editing: true, draft: target(mv.m) })}>更改</button>
                  </span>
                )}
              </div>
            </div>
            {mv.err && <p style={{ margin: '-0.25rem 0 0', fontSize: '0.75rem', color: 'var(--accent)' }}>{mv.err}</p>}
            <div className="stat3">
              <div><div className="mono" style={{ fontSize: '1.125rem' }}>{mv.gbText}</div><div className="muted" style={{ fontSize: '0.6875rem' }}>C: 多出 GB</div></div>
              <div><div className="mono" style={{ fontSize: '1.125rem' }}>{mv.after}</div><div className="muted" style={{ fontSize: '0.6875rem' }}>{mv.drive} 剩余 GB</div></div>
              <div><div style={{ fontSize: '1.125rem' }}>{mv.m.mins}</div><div className="muted" style={{ fontSize: '0.6875rem' }}>后台进行</div></div>
            </div>
            <div style={{ display: 'grid', gap: '0.375rem' }}><div style={{ fontWeight: 500 }}>点击开始后，Strandline 将自动执行：</div>
              <ol style={{ margin: 0, paddingInlineStart: '1.25rem', display: 'grid', gap: '0.25rem', lineHeight: 1.5 }}>{mv.steps.map((t) => <li key={t}>{t}</li>)}</ol>
            </div>
            <div style={{ display: 'grid', gap: '0.375rem' }}>
              {mv.m.link && <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}><span className="cbx"><input type="checkbox" className="cbx-in" checked={!s.linkOff[mv.m.id]} onChange={() => set((p) => ({ linkOff: { ...p.linkOff, [mv.m.id]: !p.linkOff[mv.m.id] } }))} /><span className="cbx-box" aria-hidden="true"><Icon name="check" size={10} /></span></span>原路径保留目录联接</label>}
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}><span className="cbx"><input type="checkbox" className="cbx-in" checked={!!s.verify[mv.m.id]} onChange={() => set((p) => ({ verify: { ...p.verify, [mv.m.id]: !p.verify[mv.m.id] } }))} /><span className="cbx-box" aria-hidden="true"><Icon name="check" size={10} /></span></span>{mv.m.verify}</label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className="btn" autoFocus onClick={closeOverlay}>取消</button>
              <button type="button" className="btn btn-primary" disabled={!!mv.err} onClick={() => { if (!mv.err) startMove(s.editing ? s.draft : target(mv.m)); }}>开始迁移</button>
            </div>
          </section>
        </Modal>
      )}
    </Shell>
  );
}

// ---------- Ctrl K on the map: commands, categories and folders, with ↑↓ Enter
interface PalProps {
  checked: Flags; leaves: Leaf[]; cats: Cat[]; moves: Move[]; sysId: string;
  set: (p: Partial<MapState>) => void; close: () => void;
  level: (id: string) => MapLevel; size: (id: string) => number; selectable: (id: string) => boolean; moveGb: (m: Move) => number;
  setMode: (k: Mode) => void; rescan: () => void; openDetail: (id: string) => void; openMove: (id: string) => void; openBell: () => void;
}
function MapPalette({ checked, leaves: LEAVES, cats: CATS, moves: MOVES, sysId, set, close, level, size, selectable, moveGb, setMode, rescan, openDetail, openMove, openBell }: PalProps) {
  const [q, setQ] = useState('');
  const [pi, setPi] = useState(0);
  const qq = q.trim().toLowerCase();
  const hit = (t: string) => !qq || t.toLowerCase().includes(qq);
  type Row = { icls: string; label: string; meta: string; kw?: string; run: () => void };
  const cmds: Row[] = [
    { icls: 'sw10 sw-L1', label: '选中全部「可重建」项', meta: '', kw: '清理 全部 可重建 缓存 clean', run: () => { const c = { ...checked }; LEAVES.forEach((l) => { if (level(l.id) === 'L1' && selectable(l.id)) c[l.id] = true; }); set({ checked: c }); close(); } },
    { icls: 'sw10 sw-L2', label: '只看可清理', meta: '', kw: '只看 可清理 筛选', run: () => setMode('clean') },
    { icls: 'sw10 sw-L4', label: '只看可迁移', meta: '', kw: '只看 可迁移 迁移 move', run: () => setMode('move') },
    { icls: 'sw10 sw-L4', label: '重新扫描 ' + sysId + ':', meta: '', kw: '扫描 rescan', run: rescan },
    { icls: 'sw10 sw-L4', label: '空间提醒设置', meta: '', kw: '提醒 通知', run: openBell },
    ...MOVES.filter((m) => moveGb(m) > 0.05).map((m) => ({ icls: 'sw10 sw-L4', label: '迁移「' + m.name + '」…', meta: moveGb(m).toFixed(1) + ' GB', kw: '迁移 move ' + m.name, run: () => openMove(m.id) })),
  ];
  const sections: [string, Row[]][] = [
    ['操作', cmds.filter((c) => hit(c.label + ' ' + c.kw))],
    ['分类', qq ? CATS.filter((c) => hit(c.name)).map((c) => ({ icls: 'sw10 sw-L4', label: c.name, meta: '定位分类', run: () => { set({ focusCat: c.id }); close(); } })) : []],
    ['文件夹', qq ? LEAVES.filter((l) => size(l.id) > 0.05 && hit(l.name + ' ' + l.pathTail + ' ' + l.short)).slice(0, 6).map((l) => ({ icls: 'sw10 sw-' + level(l.id), label: l.name, meta: size(l.id).toFixed(1) + ' GB', run: () => openDetail(l.id) })) : []],
  ];
  const rows = sections.flatMap(([, r]) => r);
  const cur = pi % Math.max(1, rows.length);
  let ri = 0;
  return (
    <AppPortal>
      <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
        <section className="pal" role="dialog" aria-modal="true" aria-label="命令面板">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--line)' }}>
            <Icon name="searchLg" size={16} />
            <label htmlFor="r7-q" className="vh">搜索或执行命令</label>
            <input id="r7-q" type="text" placeholder="搜索文件夹、分类，或输入要做的事…" autoFocus value={q} role="combobox" aria-expanded="true" aria-controls="r7-pl"
              onChange={(e) => { setQ(e.target.value); setPi(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setPi((cur + 1) % Math.max(1, rows.length)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setPi((cur - 1 + rows.length) % Math.max(1, rows.length)); }
                else if (e.key === 'Enter') { e.preventDefault(); rows[cur]?.run(); }
              }}
              style={{ flex: '1 1 auto', border: 0, outline: 0, background: 'transparent', font: 'inherit', fontSize: '0.9375rem', color: 'var(--ink)' }} />
            <button type="button" className="kbd" style={{ cursor: 'pointer' }} aria-label="关闭命令面板" onClick={close}>Esc</button>
          </div>
          <div className="sbw" style={{ ['--sbh' as string]: '40px' }}>
            <div id="r7-pl" role="listbox" className="thin sbs" style={{ padding: '0.375rem 0', maxBlockSize: '22rem' }}>
              {sections.map(([head, list]) => list.length > 0 && (
                <Fragment key={head}>
                  <div className="sec-label" style={{ padding: '0.375rem 1rem' }}>{head}</div>
                  {list.map((i) => {
                    const idx = ri++, on = idx === cur;
                    return (
                      <button key={head + i.label} type="button" role="option" aria-selected={on} className={cx('pal-item', on && 'on')} onClick={i.run} onMouseEnter={() => setPi(idx)}>
                        <span className={i.icls} /><span style={{ flex: '1 1 auto', minInlineSize: 0 }} className="ellipsis">{i.label}</span><span className="mono muted" style={{ fontSize: '0.75rem' }}>{i.meta}</span>
                      </button>
                    );
                  })}
                </Fragment>
              ))}
              {!rows.length && <div className="muted" style={{ padding: '1rem', textAlign: 'center' }}>没有找到「{q}」</div>}
            </div>
            <i className="sbt" aria-hidden="true" />
          </div>
          <div className="muted" style={{ display: 'flex', gap: '1rem', padding: '0.5rem 1rem', borderTop: '1px solid var(--line)', fontSize: '0.6875rem' }}>
            <span><span className="kbd">↑</span> <span className="kbd">↓</span> 选择</span><span><span className="kbd">Enter</span> 执行</span><span><span className="kbd">Esc</span> 关闭</span>
          </div>
        </section>
      </div>
    </AppPortal>
  );
}
