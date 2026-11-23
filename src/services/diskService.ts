// One data + action interface for every page. Two implementations:
// - MockDiskService: the design's demo data and simulated behaviour (browser, `npm run dev`, GitHub Pages)
// - TauriDiskService: the real Rust backend (desktop app)
// `diskService` picks one at startup.
import { MockDiskService } from './mock/mockService';
import { TauriDiskService } from './tauri/tauriService';
import type {
  ActivityEvent, BigFile, CleanRow, DriveInfo, DupGroup, DupSelection, History90, MapModel, MigrateOptions, MigrationProgress,
  OverviewData, Receipt, Rule, RuleRun, RuleTemplate, ScanProgress, Settings,
} from './types';

export interface DiskService {
  readonly mode: 'mock' | 'tauri';

  // drives & scanning
  listDrives(): Promise<DriveInfo[]>;
  /** last scan result for a drive (scans first if none) */
  getMapModel(drive: string): Promise<MapModel>;
  /** rescan; resolves with the fresh model. Progress callbacks arrive while it runs. */
  scan(drive: string, onProgress: (p: ScanProgress) => void): Promise<MapModel>;
  cancelScan(): Promise<void>;

  // cleaning (Recycle Bin first) & undo
  getSuggestions(drive: string): Promise<CleanRow[]>;
  clean(drive: string, ids: string[]): Promise<Receipt>;
  /** undo one receipt item (restore from the Recycle Bin / revert a setting) */
  undo(receiptId: string, itemId: string): Promise<void>;

  // large files & duplicates
  findLarge(drive: string): Promise<BigFile[]>;
  recycleFiles(ids: string[]): Promise<Receipt>;
  findDuplicates(drive: string): Promise<DupGroup[]>;
  recycleDuplicates(sel: DupSelection[]): Promise<Receipt>;
  /** undo a whole receipt */
  undoReceipt(receiptId: string): Promise<void>;

  // migration
  startMigration(moveId: string, to: string, opts: MigrateOptions): Promise<void>;
  resumeMigration(moveId: string): Promise<void>;
  onMigration(cb: (p: MigrationProgress) => void): () => void;

  // rules
  listRules(): Promise<Rule[]>;
  ruleTemplates(): Promise<RuleTemplate[]>;
  saveRule(rule: Rule): Promise<void>;
  dryRunRule(id: string): Promise<RuleRun>;
  runRule(id: string): Promise<{ run: RuleRun; receiptId: string }>;

  // records & settings
  listActivity(): Promise<ActivityEvent[]>;
  undoActivity(id: string): Promise<void>;
  getOverview(drive: string): Promise<OverviewData>;
  getHistory(drive: string): Promise<History90>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Partial<Settings>): Promise<Settings>;
  /** open a folder in Explorer */
  openPath(path: string): Promise<void>;
}

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const diskService: DiskService = inTauri ? new TauriDiskService() : new MockDiskService();
