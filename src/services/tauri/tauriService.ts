// Desktop implementation: every call goes to the Rust backend (src-tauri). Commands are snake_case,
// arguments camelCase (Tauri converts them). Long jobs report progress through events.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { DiskService } from '../diskService';
import type {
  ActivityEvent, BigFile, CleanRow, DriveInfo, DupGroup, DupSelection, History90, MapModel, MigrateOptions, MigrationProgress,
  OverviewData, Receipt, Rule, RuleRun, RuleTemplate, ScanProgress, Settings,
} from '../types';

export class TauriDiskService implements DiskService {
  readonly mode = 'tauri' as const;

  listDrives() { return invoke<DriveInfo[]>('list_drives'); }
  getMapModel(drive: string) { return invoke<MapModel>('get_map_model', { drive }); }

  async scan(drive: string, onProgress: (p: ScanProgress) => void): Promise<MapModel> {
    const un: UnlistenFn = await listen<ScanProgress>('scan-progress', (e) => onProgress(e.payload));
    try { return await invoke<MapModel>('scan_drive', { drive }); } finally { un(); }
  }
  cancelScan() { return invoke<void>('cancel_scan'); }

  getSuggestions(drive: string) { return invoke<CleanRow[]>('get_suggestions', { drive }); }
  clean(drive: string, ids: string[]) { return invoke<Receipt>('clean_items', { drive, ids }); }
  undo(receiptId: string, itemId: string) { return invoke<void>('undo_item', { receiptId, itemId }); }
  undoReceipt(receiptId: string) { return invoke<void>('undo_receipt', { receiptId }); }

  findLarge(drive: string) { return invoke<BigFile[]>('find_large', { drive }); }
  recycleFiles(ids: string[]) { return invoke<Receipt>('recycle_files', { ids }); }
  findDuplicates(drive: string) { return invoke<DupGroup[]>('find_duplicates', { drive }); }
  recycleDuplicates(sel: DupSelection[]) { return invoke<Receipt>('recycle_duplicates', { sel }); }

  startMigration(moveId: string, to: string, opts: MigrateOptions) { return invoke<void>('start_migration', { moveId, to, opts }); }
  resumeMigration(moveId: string) { return invoke<void>('resume_migration', { moveId }); }
  cancelMigration(moveId: string) { return invoke<void>('cancel_migration', { moveId }); }
  getMigrationStatus() { return invoke<MigrationProgress | null>('get_migration_status'); }
  onMigration(cb: (p: MigrationProgress) => void) {
    let un: UnlistenFn | null = null, dead = false;
    void listen<MigrationProgress>('migration-progress', (e) => cb(e.payload)).then((f) => { if (dead) f(); else un = f; });
    return () => { dead = true; un?.(); };
  }

  listRules() { return invoke<Rule[]>('list_rules'); }
  ruleTemplates() { return invoke<RuleTemplate[]>('rule_templates'); }
  saveRule(rule: Rule) { return invoke<void>('save_rule', { rule }); }
  deleteRule(id: string) { return invoke<void>('delete_rule', { id }); }
  dryRunRule(id: string) { return invoke<RuleRun>('dry_run_rule', { id }); }
  runRule(id: string) { return invoke<{ run: RuleRun; receiptId: string }>('run_rule', { id }); }

  listActivity() { return invoke<ActivityEvent[]>('list_activity'); }
  undoActivity(id: string) { return invoke<void>('undo_activity', { id }); }
  getOverview(drive: string) { return invoke<OverviewData>('get_overview', { drive }); }
  getHistory(drive: string) { return invoke<History90>('get_history', { drive }); }
  getSettings() { return invoke<Settings>('get_settings'); }
  saveSettings(s: Partial<Settings>) { return invoke<Settings>('save_settings', { patch: s }); }
  openPath(path: string) { return invoke<void>('open_path', { path }); }
}
