// Domain types shared by the UI and both DiskService implementations (mock + Tauri).
// Sizes are GB (floating point) unless the field name says otherwise; times are ms since epoch.

export type Level = 'L1' | 'L2' | 'L3';
export type MapLevel = Level | 'L4';
/** What cleaning an item does. Real mode never deletes permanently except `empty` (emptying the Recycle Bin, confirmed). */
export type MapAct = 'keep' | 'setting' | 'rebuild' | 'recycle' | 'empty';

export interface DriveInfo {
  /** drive letter without colon, e.g. "C" */
  id: string;
  name: string;
  total: number;
  free: number;
  /** free space 30 days ago (from history; equals `free` when unknown) */
  free30: number;
}

/** One block on the space map (a folder, file group or system item). */
export interface Leaf {
  id: string; cat: string; catName: string;
  name: string; short: string; xs: string;
  /** current size */
  gb: number;
  /** what cleaning would free (L2 items may free only part of their size) */
  gain: number;
  level: MapLevel; act: MapAct;
  pathHead: string; pathTail: string;
  note: string; cmd: string;
  /** recognised from local metadata only (names, types, sizes, times) */
  meta: boolean;
  /** id of the migration plan that can move this item, or "" */
  move: string;
  /** scan-reveal order, 0–100 (used while scanning) */
  rv: number;
  /** what cleaning actually freed last time (mock) */
  actual: number;
  /** already cleaned this session — no longer selectable */
  cleaned?: boolean;
}
export interface Cat { id: string; name: string; short: string; items: string[]; cl: string }
export interface Move { id: string; name: string; cells: string[]; frm: string; to: string; how: string; mins: string; link: boolean; verify: string; steps: string[]; generic: boolean }

export interface MapModel {
  drive: DriveInfo;
  leaves: Leaf[];
  cats: Cat[];
  moves: Move[];
  /** GB in the Recycle Bin on this drive */
  bin: number;
  /** last 29 daily free-space samples before today (oldest first) */
  history30: number[];
  /** "HH:MM" of the last scan */
  scannedAt: string;
  /** desktop: what the scan counted and left out */
  stats?: ScanStats;
}

export interface ScanStats {
  files: number;
  /** folders / files that could not be read (no permission, in use) */
  skipped: number;
  /** online-only cloud files: not counted, never opened */
  cloudFiles: number;
  cloudGb: number;
  /** extra paths to hard-linked files, counted once */
  hardlinks: number;
  tookSec: number;
}

export interface ScanProgress {
  /** 0–100 */
  p: number;
  phase: 'index' | 'classify';
  files: number;
  gb: number;
}

export interface ReceiptItem { id: string; name: string; act: MapAct; level: MapLevel; gb: number; undoable: boolean }
export interface Receipt {
  id: string;
  /** GB actually freed on disk */
  freed: number;
  /** GB moved to the Recycle Bin (freed only after it is emptied) */
  bin: number;
  items: ReceiptItem[];
  /** items skipped, with the reason (protected path, in use, Recycle Bin too small…) */
  skipped: { name: string; reason: string }[];
}

export type MigrationState = 'running' | 'paused' | 'done' | 'error';
export interface MigrationProgress {
  moveId: string;
  /** 0–100 */
  pct: number;
  state: MigrationState;
  /** target drive letter */
  drive: string;
  gb: number;
  message?: string;
}
export interface MigrateOptions { link: boolean; verify: boolean }

// ---- Suggestions page
export type CleanAct = Exclude<MapAct, 'keep'>;
export interface CleanRow { id: string; name: string; level: Level; act: CleanAct; gain: number; head: string; tail: string; note: string; cmd: string; meta: boolean; last: string; days: number; done?: boolean }

// ---- Large files page
export type FType = 'video' | 'img' | 'model' | 'inst' | 'zip' | 'data' | 'sys';
export type ManagedKind = 'map' | 'vm' | 'hiber' | 'copy' | null;
export interface BigFile { id: string; name: string; dir: string; gb: number; type: FType; last: string; managed: string; act: string | null; kind: ManagedKind; why: string | null }

// ---- Duplicates page
export interface DupCopy { dir: string; date: string }
export interface DupGroup { id: string; name: string; each: number; copies: DupCopy[] }
export interface DupSelection { groupId: string; keep: number }

// ---- Rules page
export type Sched = 'new' | 'day' | 'week' | 'month';
export interface RuleCond { k: string; v: string }
export interface Rule {
  id: string; name: string; on: boolean; sched: Sched; lv: string; do: string;
  when: [string, string][];
  last: string;
  /** dry-run preview: [file name, GB] */
  files: [string, number][];
  /** ms epoch of the last run (desktop scheduler) */
  lastRun?: number;
}
export interface RuleTemplate { name: string; when: [string, string][]; do: string; lv: string; sched: Sched }
export interface RuleRun { n: number; gb: number; files: [string, number][] }

// ---- Activity page
export type EventKind = 'clean' | 'move' | 'rule' | 'scan';
export interface ActivityEvent {
  id: string; day: string; time: string; kind: EventKind; title: string; detail: string; amount: string;
  /** label of the undo action ("撤销" / "搬回 C:"), "" when not undoable */
  undo: string;
  items: [string, string, string][];
  undone?: boolean;
}

// ---- Overview
export interface Grower { name: string; lv: string; gb: number }
export interface OverviewData {
  growers: Grower[];
  growTotal: number;
  /** one line under the growth list ("" when there is nothing to compare yet) */
  growNote: string;
  /** times the automatic rules ran in the last 90 days */
  ruleRuns: number;
  rulesOn: [string, string][];
  rulesOff: number;
  /** ids the overview's one-tap clean covers (safe, rebuildable caches) */
  foamIds: string[];
  /** newest first: [time, kind, title, amount] */
  recent: [string, EventKind, string, string][];
}

// ---- 90-day history (Suggestions calendar)
export interface History90 {
  /** 91 daily samples of C: free GB, index 90 = today (null where unknown) */
  level: (number | null)[];
  cleans: Record<number, [string, number]>;
  moves: Record<number, [string, number]>;
  ruleDays: Record<number, number>;
  /** ms epoch of day 0 */
  start: number;
}

// ---- Settings
export interface Settings {
  autostart: boolean; sound: boolean; daily: boolean; recycleFirst: boolean; checkRunning: boolean; skipInUse: boolean;
  low: boolean; weekly: boolean; inst: boolean;
  close: 'tray' | 'quit';
  bin: '30' | '60' | 'never';
  drives: Record<string, boolean>;
  excl: string[];
  /** folder scanned instead of a whole drive (sandbox mode for development); "" = scan the drive */
  scanRoot: string;
  /** scan only: the desktop backend refuses every write */
  readOnly: boolean;
  /** the first-run safety notice was answered */
  ackSafety: boolean;
}
