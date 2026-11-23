// Demo implementation: the R19 design's data and simulated behaviour, kept in memory.
// Used in a plain browser (npm run dev, GitHub Pages). Nothing here touches the real disk.
import type { DiskService } from '../diskService';
import type {
  ActivityEvent, BigFile, Cat, CleanRow, DriveInfo, DupGroup, DupSelection, History90, Leaf, MapModel, MigrateOptions,
  MigrationProgress, OverviewData, Receipt, Rule, RuleRun, RuleTemplate, ScanProgress, Settings,
} from '../types';
import { CLEANS, C_FREE_0, HIST30, LEVEL90, MOVES90, RULEDAYS } from './data/history';
import { CATS, LEAVES, MOVES } from './data/map';
import { EVENTS, FILES, GROUPS, GROW, RECENT, RULES, TPLS } from './data/pages';
import { ROWS } from './data/suggest';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const now = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const fmtGb = (g: number) => (g >= 1 ? g.toFixed(1) + ' GB' : Math.round(g * 1000) + ' MB');
const DRIVE_META: Record<string, { name: string; total: number; free30: number }> = {
  C: { name: '系统盘', total: 512, free30: 87.2 }, D: { name: '数据盘', total: 1000, free30: 401.5 }, E: { name: '移动硬盘', total: 965, free30: 637.0 },
};
const FOAM_IDS = ['temp', 'browser', 'pip', 'npm', 'nvidia', 'delivery'];

/** Demo data drives: a few kept folders, nothing to clean. */
const keepLeaf = (id: string, cat: string, catName: string, name: string, gb: number, head: string): Leaf => ({
  id, cat, catName, name, short: name, xs: '', gb, gain: gb, level: 'L4', act: 'keep', pathHead: head, pathTail: name,
  note: '', cmd: '', meta: false, move: '', rv: 50, actual: gb,
});
const OTHER: Record<string, { leaves: Leaf[]; cats: Cat[] }> = {
  D: {
    leaves: [keepLeaf('d_ds', 'user', '个人数据', 'Datasets', 318.4, 'D:\\'), keepLeaf('d_wx', 'user', '个人数据', 'WeChat Files', 96.2, 'D:\\'),
      keepLeaf('d_zot', 'user', '个人数据', 'Zotero', 6.4, 'D:\\'), keepLeaf('d_vid', 'docs', '文稿与照片', '视频', 121.0, 'D:\\'), keepLeaf('d_bak', 'docs', '文稿与照片', 'Backups', 70.0, 'D:\\')],
    cats: [{ id: 'user', name: '个人数据', short: '个人数据', items: ['d_ds', 'd_wx', 'd_zot'], cl: '其他' }, { id: 'docs', name: '文稿与照片', short: '文稿与照片', items: ['d_vid', 'd_bak'], cl: '其他' }],
  },
  E: {
    leaves: [keepLeaf('e_photo', 'docs', '文稿与照片', '照片备份', 248.0, 'E:\\'), keepLeaf('e_raw', 'user', '个人数据', '原始影像', 80.0, 'E:\\')],
    cats: [{ id: 'docs', name: '文稿与照片', short: '文稿与照片', items: ['e_photo'], cl: '其他' }, { id: 'user', name: '个人数据', short: '个人数据', items: ['e_raw'], cl: '其他' }],
  },
};

interface Undo { receipt: Receipt; revert: Record<string, () => void>; revertAll?: () => void }

export class MockDiskService implements DiskService {
  readonly mode = 'mock' as const;

  private free: Record<string, number> = { C: C_FREE_0, D: 388.0, E: 637.0 };
  private leaves: Leaf[] = clone(LEAVES);
  private orig: Record<string, Leaf> = Object.fromEntries(LEAVES.map((l) => [l.id, clone(l)]));
  private bin = 9.6;
  private moved: Record<string, { d: string; gb: number }> = {};
  private scannedAt = '13:52';
  private goneFiles: Record<string, boolean> = {};
  private dupesDone = false;
  private rules: Rule[] = clone(RULES);
  private events: ActivityEvent[] = clone(EVENTS);
  private recent: OverviewData['recent'] = clone(RECENT);
  private todayClean = 0;
  private undos: Record<string, Undo> = {};
  private rid = 1;
  private scanTimer: number | null = null;
  private scanDone: (() => void) | null = null;
  private mig: { id: string; pct: number; paused: boolean; retried: boolean; drive: string; timer: number | null } | null = null;
  private migListeners = new Set<(p: MigrationProgress) => void>();
  private settings: Settings = {
    autostart: true, sound: false, daily: true, recycleFirst: true, checkRunning: true, skipInUse: true, low: true, weekly: false, inst: true,
    close: 'tray', bin: '30', drives: { C: true, D: true, E: false }, excl: ['%USERPROFILE%\\Projects\\active', 'D:\\Backups'], scanRoot: '', readOnly: false, ackSafety: true,
  };

  private leaf(id: string) { return this.leaves.find((l) => l.id === id)!; }
  private drive(id: string): DriveInfo { const m = DRIVE_META[id]; return { id, name: m.name, total: m.total, free: this.free[id], free30: m.free30 }; }
  private newReceipt(): Receipt { return { id: 'r' + this.rid++, freed: 0, bin: 0, items: [], skipped: [] }; }
  private log(e: Omit<ActivityEvent, 'id' | 'day' | 'time'>, recentTitle?: string) {
    const t = now();
    this.events.unshift({ id: 'm' + this.rid++, day: '今天', time: t, ...e });
    this.recent.unshift(['刚刚', e.kind, recentTitle ?? e.title, e.amount]);
  }

  // ---------- drives & scanning
  async listDrives() { return ['C', 'D', 'E'].map((d) => this.drive(d)); }

  async getMapModel(drive: string): Promise<MapModel> {
    const other = OTHER[drive];
    if (other) {
      const d = this.drive(drive);
      return { drive: d, leaves: clone(other.leaves), cats: clone(other.cats), moves: [], bin: 0, history30: new Array(29).fill(d.free30), scannedAt: this.scannedAt };
    }
    const leaves = this.leaves.map((l) => ({ ...l, gb: l.id === 'recycle' ? this.bin : l.gb }));
    return { drive: this.drive(drive), leaves, cats: clone(CATS), moves: clone(MOVES).filter((m) => !this.moved[m.id]), bin: this.bin, history30: HIST30.slice(), scannedAt: this.scannedAt };
  }

  scan(drive: string, onProgress: (p: ScanProgress) => void): Promise<MapModel> {
    void this.cancelScan();
    return new Promise((resolve) => {
      let p = 0;
      const finish = () => { if (this.scanTimer) clearInterval(this.scanTimer); this.scanTimer = null; this.scanDone = null; void this.getMapModel(drive).then(resolve); };
      this.scanDone = finish;
      this.scanTimer = window.setInterval(() => {
        p = Math.min(100, p + 1.5);
        onProgress({ p, phase: p < 64 ? 'index' : 'classify', files: Math.round(412000 * p / 100), gb: 468 * p / 100 });
        if (p >= 100) { this.scannedAt = '13:58'; finish(); }
      }, 90);
    });
  }
  async cancelScan() { this.scanDone?.(); }

  // ---------- cleaning
  async getSuggestions(drive = 'C'): Promise<CleanRow[]> {
    if (drive !== 'C') return [];
    return ROWS.map((r) => ({ ...r, done: !!this.leaves.find((l) => l.id === r.id)?.cleaned }));
  }

  async clean(drive: string, ids: string[]): Promise<Receipt> {
    const rc = this.newReceipt(), revert: Undo['revert'] = {};
    for (const id of ids) {
      const L = this.leaf(id);
      if (!L || L.cleaned) continue;
      const o = this.orig[id];
      let amt: number;
      if (L.act === 'empty') { amt = this.bin; rc.freed += amt; this.bin = 0; }
      else if (L.act === 'recycle') {
        amt = L.gb; rc.bin += amt; this.bin += amt;
        revert[id] = () => { this.bin = Math.max(0, this.bin - amt); Object.assign(L, clone(o)); };
      } else {
        amt = L.actual; rc.freed += amt; this.free[drive] += amt;
        if (L.act === 'setting') revert[id] = () => { this.free[drive] -= amt; Object.assign(L, clone(o)); };
      }
      if (L.act !== 'empty') {
        L.gb = Math.max(0, o.gb - o.gain);
        if (L.level === 'L2' && L.gb > 0.05) L.level = 'L4';
        L.cleaned = true;
      }
      rc.items.push({ id, name: L.name, act: L.act, level: o.level, gb: amt, undoable: L.act === 'recycle' || L.act === 'setting' });
    }
    if (rc.items.some((i) => i.act === 'empty')) this.free[drive] += rc.items.find((i) => i.act === 'empty')!.gb;
    this.undos[rc.id] = { receipt: rc, revert };
    if (ids.length && ids.every((id) => FOAM_IDS.includes(id)) && ids.length === FOAM_IDS.length) {
      this.todayClean = rc.freed;
      this.log({ kind: 'clean', title: '一键清理 6 项缓存', detail: '可重建的缓存会在用到时自动长回来', amount: rc.freed.toFixed(1) + ' GB', undo: '', items: rc.items.map((i) => [i.level, i.name, i.gb.toFixed(1) + ' GB']) });
    } else if (rc.items.length) {
      this.todayClean += rc.freed;
      this.log({ kind: 'clean', title: '清理 ' + rc.items.length + ' 项', detail: rc.bin > 0.05 ? rc.bin.toFixed(1) + ' GB 移入回收站' : '可重建的缓存会在用到时自动长回来', amount: (rc.freed + rc.bin).toFixed(1) + ' GB', undo: '', items: rc.items.map((i) => [i.level, i.name, i.gb.toFixed(1) + ' GB']) });
    }
    return rc;
  }

  async undo(receiptId: string, itemId: string) { this.undos[receiptId]?.revert[itemId]?.(); }
  async undoReceipt(receiptId: string) {
    const u = this.undos[receiptId];
    if (!u) return;
    if (u.revertAll) u.revertAll(); else Object.values(u.revert).forEach((f) => f());
    delete this.undos[receiptId];
  }

  // ---------- large files & duplicates
  async findLarge(drive = 'C'): Promise<BigFile[]> { if (drive !== 'C') return []; return clone(FILES).filter((f) => !this.goneFiles[f.id]); }
  async recycleFiles(ids: string[]): Promise<Receipt> {
    const rc = this.newReceipt();
    for (const id of ids) {
      const f = FILES.find((x) => x.id === id);
      if (!f || f.managed || this.goneFiles[id]) continue;
      this.goneFiles[id] = true; rc.bin += f.gb;
      rc.items.push({ id, name: f.name, act: 'recycle', level: 'L2', gb: f.gb, undoable: true });
    }
    this.bin += rc.bin;
    this.undos[rc.id] = { receipt: rc, revert: {}, revertAll: () => { rc.items.forEach((i) => { delete this.goneFiles[i.id]; }); this.bin -= rc.bin; } };
    return rc;
  }
  async findDuplicates(drive = 'C'): Promise<DupGroup[]> { if (drive !== 'C') return []; return this.dupesDone ? [] : clone(GROUPS); }
  async recycleDuplicates(sel: DupSelection[]): Promise<Receipt> {
    const rc = this.newReceipt();
    for (const s of sel) {
      const g = GROUPS.find((x) => x.id === s.groupId);
      if (!g) continue;
      g.copies.forEach((c, i) => { if (i !== s.keep) { rc.bin += g.each; rc.items.push({ id: g.id + ':' + i, name: g.name + ' · ' + c.dir, act: 'recycle', level: 'L2', gb: g.each, undoable: true }); } });
    }
    this.dupesDone = true; this.bin += rc.bin;
    this.undos[rc.id] = { receipt: rc, revert: {}, revertAll: () => { this.dupesDone = false; this.bin -= rc.bin; } };
    return rc;
  }

  // ---------- migration (Ollama pauses once at 30% because "it is running", as in the design)
  private emit(p: MigrationProgress) { this.migListeners.forEach((f) => f(p)); }
  private tick() {
    const m = this.mig!;
    if (m.timer) clearInterval(m.timer);
    m.timer = window.setInterval(() => {
      if (m.paused) return;
      const plan = MOVES.find((x) => x.id === m.id)!;
      const gb = plan.cells.reduce((a, c) => a + this.leaf(c).gb, 0);
      const next = m.pct + 2.5;
      if (m.id === 'm_ollama' && m.pct < 30 && next >= 30 && !m.retried) {
        m.pct = 30; m.paused = true;
        this.emit({ moveId: m.id, pct: 30, state: 'paused', drive: m.drive, gb, message: 'Ollama 正在运行，迁移已暂停' });
        return;
      }
      if (next >= 100) {
        clearInterval(m.timer!); this.mig = null;
        this.moved[m.id] = { d: m.drive, gb };
        plan.cells.forEach((c) => { this.leaf(c).gb = 0; });
        this.free.C += gb;
        if (this.free[m.drive] !== undefined) this.free[m.drive] -= gb;
        this.log({ kind: 'move', title: '迁移 ' + plan.name + ' → ' + m.drive + ':', detail: plan.link ? '原处留了联接' : plan.how, amount: gb.toFixed(1) + ' GB', undo: '', items: [] });
        this.emit({ moveId: m.id, pct: 100, state: 'done', drive: m.drive, gb });
      } else { m.pct = next; this.emit({ moveId: m.id, pct: next, state: 'running', drive: m.drive, gb }); }
    }, 120);
  }
  async startMigration(moveId: string, to: string, _opts: MigrateOptions) {
    void _opts;
    if (this.mig?.timer) clearInterval(this.mig.timer);
    const drive = (/^\s*([A-Za-z]):/.exec(to)?.[1] ?? 'D').toUpperCase();
    this.mig = { id: moveId, pct: 0, paused: false, retried: false, drive, timer: null };
    this.tick();
  }
  async resumeMigration(moveId: string) {
    if (!this.mig || this.mig.id !== moveId) return;
    this.mig.paused = false; this.mig.retried = true;
    this.tick();
  }
  onMigration(cb: (p: MigrationProgress) => void) { this.migListeners.add(cb); return () => { this.migListeners.delete(cb); }; }

  // ---------- rules
  async listRules() { return clone(this.rules); }
  async ruleTemplates(): Promise<RuleTemplate[]> { return clone(TPLS); }
  async saveRule(rule: Rule) {
    const i = this.rules.findIndex((r) => r.id === rule.id);
    if (i >= 0) this.rules[i] = clone(rule); else this.rules.push(clone(rule));
  }
  async dryRunRule(id: string): Promise<RuleRun> {
    const r = this.rules.find((x) => x.id === id);
    const files = r ? r.files : [];
    return { n: files.length, gb: files.reduce((a, f) => a + f[1], 0), files };
  }
  async runRule(id: string) {
    const run = await this.dryRunRule(id);
    const r = this.rules.find((x) => x.id === id)!;
    const prev = r.last;
    r.last = '刚刚 · ' + run.n + ' 个文件' + (run.gb >= 0.5 ? ' · ' + fmtGb(run.gb) : '');
    const rc = this.newReceipt();
    this.undos[rc.id] = { receipt: rc, revert: {}, revertAll: () => { r.last = prev; } };
    this.log({ kind: 'rule', title: '规则「' + r.name + '」', detail: run.n + ' 个文件', amount: fmtGb(run.gb), undo: '撤销', items: run.files.map(([n, g]) => [r.lv, n, fmtGb(g)]) });
    return { run, receiptId: rc.id };
  }

  // ---------- records & settings
  async listActivity() { return clone(this.events); }
  async undoActivity(id: string) { const e = this.events.find((x) => x.id === id); if (e) e.undone = true; }
  async getOverview(): Promise<OverviewData> {
    return {
      growers: clone(GROW), growTotal: 43.2, growNote: '微信和 Docker 占了这 30 天涨幅的一半，适合搬到 D:', ruleRuns: 28,
      rulesOn: this.rules.filter((r) => r.on).map((r) => [r.name, ({ new: '新文件出现时', day: '每天', week: '每周日', month: '每月 1 日' } as const)[r.sched]]),
      rulesOff: this.rules.filter((r) => !r.on).length,
      foamIds: FOAM_IDS, recent: this.recent.slice(0, 3),
    };
  }
  async getHistory(): Promise<History90> {
    const level: (number | null)[] = LEVEL90.slice();
    level[90] = this.free.C;
    const cleans = { ...CLEANS };
    if (this.todayClean > 0.05) cleans[90] = ['一键清理缓存', this.todayClean];
    return { level, cleans, moves: { ...MOVES90 }, ruleDays: { ...RULEDAYS }, start: new Date(2026, 7, 23).getTime() };
  }
  async getSettings() { return { ...clone(this.settings), sound: localStorage.getItem('strandline.sound') === '1' }; }
  async saveSettings(s: Partial<Settings>) { this.settings = { ...this.settings, ...clone(s) }; return this.getSettings(); }
  async openPath() { /* demo: nothing to open */ }
}

