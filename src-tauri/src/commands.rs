//! Tauri commands called by `src/services/tauri/tauriService.ts`. Errors are user-facing Chinese text.
//! Long work (scan, hashing, copying) runs on blocking threads; locks are held only briefly.

use crate::catalog::{self, Built};
use crate::drives;
use crate::finder;
use crate::model::*;
use crate::sandbox::{self, Roots};
use crate::scan::{self, ScanResult};
use crate::store::{self, now_ms, DAY_MS};
use crate::timefmt::{day_label, hhmm, local_day};
use crate::AppState;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, State};

pub type CmdResult<T> = Result<T, String>;

/// Duplicate groups plus group id → the identical files.
pub type Dupes = (Vec<DupGroup>, HashMap<String, Vec<PathBuf>>);

/// The last scan and everything derived from it.
pub struct Scanned {
    pub result: ScanResult,
    pub built: Built,
    /// drive letter holding the scan root
    pub drive: String,
    pub scan_root: String,
    pub large_ids: HashMap<String, PathBuf>,
    pub dupes: Option<Dupes>,
    /// map blocks cleaned since this scan
    pub cleaned: HashSet<String>,
}

/// One scan per target (C:, D:, a sandbox…); the one in use is "active".
#[derive(Default)]
pub struct ScanCache {
    map: HashMap<String, Scanned>,
    active: Option<String>,
}

impl ScanCache {
    pub fn as_ref(&self) -> Option<&Scanned> {
        self.active.as_ref().and_then(|k| self.map.get(k))
    }
    pub fn as_mut(&mut self) -> Option<&mut Scanned> {
        let k = self.active.clone()?;
        self.map.get_mut(&k)
    }
    pub fn insert(&mut self, s: Scanned) {
        let k = scan_key(&s.drive, &s.scan_root);
        self.active = Some(k.clone());
        self.map.insert(k, s);
    }
    /// Make the scan for `key` active; false when that target was never scanned.
    pub fn activate(&mut self, key: &str) -> bool {
        if self.map.contains_key(key) {
            self.active = Some(key.to_string());
            true
        } else {
            false
        }
    }
}

pub fn lock<T>(m: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// What to scan: the sandbox folder from settings, or the whole drive.
pub fn target(state: &AppState, drive: &str) -> CmdResult<(PathBuf, Roots, String, String)> {
    let root = lock(&state.store).data.settings.scan_root.trim().to_string();
    if root.is_empty() {
        let d = drive.to_ascii_uppercase();
        return Ok((PathBuf::from(format!("{d}:\\")), Roots::real(&d), d, String::new()));
    }
    let p = PathBuf::from(&root);
    if !sandbox::is_sandbox(&p) {
        return Err(format!("扫描范围 {root} 不是沙盒文件夹（缺少 {} 标记）。请改为整盘，或先用 sandbox-gen 生成沙盒", sandbox::MARKER));
    }
    let letter = root.chars().next().map(|c| c.to_ascii_uppercase().to_string()).unwrap_or_else(|| "C".into());
    Ok((p.clone(), Roots::for_sandbox(&p), letter, root))
}

fn drive_info(state: &AppState, letter: &str) -> CmdResult<(DriveInfo, Vec<DriveInfo>)> {
    let st = lock(&state.store);
    let all = drives::list(|d| st.free_days_ago(d, 30));
    let d = all.iter().find(|d| d.id == letter).cloned().ok_or_else(|| format!("找不到 {letter}: 盘"))?;
    Ok((d, all))
}

fn history30(state: &AppState, drive: &DriveInfo) -> Vec<f64> {
    let st = lock(&state.store);
    (0..29).map(|i| st.free_days_ago(&drive.id, 29 - i).unwrap_or(drive.free)).collect()
}

pub fn rebuild(state: &AppState, sc: &mut Scanned) -> CmdResult<()> {
    let (d, all) = drive_info(state, &sc.drive)?;
    let cleaned = sc.cleaned.clone();
    let h = history30(state, &d);
    let at = sc.built.model.scanned_at.clone();
    sc.built = catalog::build(&sc.result, &d, &all, &cleaned, h, at);
    Ok(())
}

/// Scan synchronously (call from a blocking thread). Emits `scan-progress`.
fn do_scan(app: &AppHandle, drive: &str) -> CmdResult<()> {
    let state = app.state::<AppState>();
    let (root, roots, letter, scan_root) = target(&state, drive)?;
    let excluded: Vec<PathBuf> = lock(&state.store).data.settings.excl.iter().map(|e| PathBuf::from(crate::paths::expand_env(e))).collect();
    let (d, all) = drive_info(&state, &letter)?;
    let used = ((d.total - d.free) * catalog::GB).max(1.0);
    state.cancel.store(false, Ordering::Relaxed);
    let cancel = state.cancel.clone();
    let sandboxed = roots.sandbox;
    let res = scan::scan(&root, &roots, &excluded, &cancel, |p| {
        let pct = if sandboxed { 100.0 * (1.0 - (-(p.files as f64) / 30.0).exp()) } else { p.bytes as f64 / used * 100.0 };
        let _ = app.emit("scan-progress", ScanProgress { p: pct.clamp(0.0, 97.0), phase: "index", files: p.files, gb: p.bytes as f64 / catalog::GB });
    }).ok_or("已停止扫描")?;
    let _ = app.emit("scan-progress", ScanProgress { p: 98.0, phase: "classify", files: res.nfiles, gb: res.total as f64 / catalog::GB });

    let h = history30(&state, &d);
    let built = catalog::build(&res, &d, &all, &HashSet::new(), h, hhmm(now_ms()));
    let (_, large_ids) = finder::large(&res.files, &res.roots);
    {
        let mut st = lock(&state.store);
        st.snapshot_sizes(&scan_key(&letter, &scan_root), built.model.leaves.iter().map(|l| (l.name.clone(), l.gb)).collect());
        st.log(ActivityEvent {
            id: String::new(), day: String::new(), time: String::new(), kind: "scan".into(),
            title: if scan_root.is_empty() { format!("扫描 {letter}:") } else { "扫描沙盒".into() },
            detail: {
                let mut d = format!("{} · {} 秒", if res.nfiles >= 10_000 { format!("{:.1} 万个文件", res.nfiles as f64 / 10_000.0) } else { format!("{} 个文件", res.nfiles) }, res.took.as_secs().max(1));
                if res.skipped > 0 { d += &format!(" · 跳过 {} 个无权限或被占用的项", res.skipped); }
                if res.cloud_files > 0 { d += &format!(" · {} 个仅在云端的文件未计入", res.cloud_files); }
                d
            },
            amount: format!("{:.0} GB", res.total as f64 / catalog::GB), undo: String::new(), items: vec![], undone: false, at: 0, receipt: None,
        });
        st.save();
    }
    lock(&state.scan).insert(Scanned { result: res, built, drive: letter, scan_root, large_ids, dupes: None, cleaned: HashSet::new() });
    let _ = app.emit("scan-progress", ScanProgress { p: 100.0, phase: "classify", files: 0, gb: 0.0 });
    Ok(())
}

pub fn scan_key(letter: &str, scan_root: &str) -> String {
    if scan_root.is_empty() { letter.to_string() } else { format!("sandbox:{scan_root}") }
}

/// Is the cached scan still for the current target?
pub fn current(state: &AppState, drive: &str) -> bool {
    let Ok((_, _, letter, root)) = target(state, drive) else { return false };
    lock(&state.scan).activate(&scan_key(&letter, &root))
}

pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> CmdResult<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

// ---------------- drives & scanning

#[tauri::command]
pub fn list_drives(state: State<AppState>) -> CmdResult<Vec<DriveInfo>> {
    let mut st = lock(&state.store);
    let list = drives::list(|d| st.free_days_ago(d, 30));
    log::info!("list_drives: {} drive(s)", list.len());
    for d in &list {
        st.sample_free(&d.id, d.free);
    }
    st.save();
    Ok(list)
}

#[tauri::command]
pub fn get_map_model(state: State<AppState>, drive: String) -> CmdResult<MapModel> {
    if current(&state, &drive) {
        let mut g = lock(&state.scan);
        let sc = g.as_mut().expect("checked");
        rebuild(&state, sc)?;
        return Ok(sc.built.model.clone());
    }
    // no scan yet for this target: an empty model tells the UI to scan
    let (_, _, letter, _) = target(&state, &drive)?;
    let (d, _) = drive_info(&state, &letter)?;
    Ok(MapModel { drive: d, leaves: vec![], cats: vec![], moves: vec![], bin: 0.0, history30: vec![], scanned_at: String::new(), stats: None })
}

#[tauri::command]
pub async fn scan_drive(app: AppHandle, drive: String) -> CmdResult<MapModel> {
    let a = app.clone();
    blocking(move || do_scan(&a, &drive)).await?;
    let state = app.state::<AppState>();
    let g = lock(&state.scan);
    Ok(g.as_ref().map(|s| s.built.model.clone()).ok_or("扫描没有结果")?)
}

#[tauri::command]
pub fn cancel_scan(state: State<AppState>) {
    state.cancel.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub fn get_suggestions(state: State<AppState>, drive: String) -> CmdResult<Vec<CleanRow>> {
    if !current(&state, &drive) {
        return Ok(vec![]);
    }
    let mut g = lock(&state.scan);
    let sc = g.as_mut().expect("checked");
    rebuild(&state, sc)?;
    Ok(sc.built.rows.clone())
}

pub async fn ensure_scanned(app: &AppHandle, drive: &str) -> CmdResult<()> {
    if current(&app.state::<AppState>(), drive) {
        return Ok(());
    }
    let (a, d) = (app.clone(), drive.to_string());
    blocking(move || do_scan(&a, &d)).await
}

#[tauri::command]
pub async fn find_large(app: AppHandle, drive: String) -> CmdResult<Vec<BigFile>> {
    ensure_scanned(&app, &drive).await?;
    let state = app.state::<AppState>();
    let mut g = lock(&state.scan);
    let sc = g.as_mut().ok_or("还没有扫描")?;
    // drop files that are gone (recycled since the scan); bring back ones that were restored
    sc.result.files.retain(|f| f.path.exists());
    let (rows, ids) = finder::large(&sc.result.files, &sc.result.roots);
    sc.large_ids = ids;
    Ok(rows)
}

#[tauri::command]
pub async fn find_duplicates(app: AppHandle, drive: String) -> CmdResult<Vec<DupGroup>> {
    ensure_scanned(&app, &drive).await?;
    let a = app.clone();
    blocking(move || {
        let state = a.state::<AppState>();
        let (files, roots) = {
            let mut g = lock(&state.scan);
            let sc = g.as_mut().ok_or("还没有扫描")?;
            if let Some((groups, _)) = &sc.dupes {
                return Ok(groups.clone());
            }
            sc.result.files.retain(|f| f.path.exists());
            (sc.result.files.clone(), sc.result.roots.clone())
        };
        let found = finder::duplicates(&files, &roots);
        let groups = found.0.clone();
        if let Some(sc) = lock(&state.scan).as_mut() {
            sc.dupes = Some(found);
        }
        Ok(groups)
    }).await
}

// ---------------- overview & history

#[tauri::command]
pub fn get_overview(state: State<AppState>, drive: String) -> CmdResult<OverviewData> {
    let cur = current(&state, &drive);
    let (leaves, foam, key, moves): (Vec<Leaf>, Vec<String>, String, Vec<Move>) = if cur {
        let g = lock(&state.scan);
        let sc = g.as_ref().expect("checked");
        (sc.built.model.leaves.clone(), sc.built.foam.clone(), scan_key(&sc.drive, &sc.scan_root), sc.built.model.moves.clone())
    } else {
        (vec![], vec![], String::new(), vec![])
    };
    let st = lock(&state.store);
    // growth since the oldest snapshot of the last 35 days
    let mut growers: Vec<Grower> = match st.old_sizes(&key) {
        Some(old) => leaves.iter().filter_map(|l| {
            let d = l.gb - old.get(&l.name).copied().unwrap_or(0.0);
            (d >= 0.05).then(|| Grower { name: l.name.clone(), lv: l.level.clone(), gb: d })
        }).collect(),
        None => vec![],
    };
    growers.sort_by(|a, b| b.gb.total_cmp(&a.gb));
    growers.truncate(7);
    let grow_total = growers.iter().map(|g| g.gb).sum::<f64>();
    let grow_note = match growers.as_slice() {
        [] => String::new(),
        [a] => format!("{} 涨得最多", a.name),
        [a, b, ..] => {
            let movable = leaves.iter().any(|l| (l.name == a.name || l.name == b.name) && !l.move_id.is_empty());
            let target = moves.first().and_then(|m| m.to.chars().next()).map(|c| format!("，适合搬到 {c}:")).unwrap_or_default();
            format!("{} 和 {} 涨得最多{}", a.name, b.name, if movable { target } else { String::new() })
        }
    };
    let cutoff = now_ms() - 90 * DAY_MS;
    let today = local_day(now_ms());
    let recent = st.data.activity.iter().filter(|e| !e.undone).take(3).map(|e| {
        let t = if local_day(e.at) == today { hhmm(e.at) } else { let (_, m, d) = crate::timefmt::civil_from_days(local_day(e.at)); format!("{m}/{d}") };
        let title = if e.kind == "scan" { format!("{} · {}", e.title, e.detail) } else { e.title.clone() };
        (t, e.kind.clone(), title, e.amount.clone())
    }).collect();
    let sched = |s: &str| match s { "new" => "新文件出现时", "day" => "每天", "week" => "每周日", "month" => "每月 1 日", _ => "" }.to_string();
    Ok(OverviewData {
        growers, grow_total, grow_note,
        rule_runs: st.data.activity.iter().filter(|e| e.kind == "rule" && e.at >= cutoff && !e.undone).count() as u32,
        rules_on: st.data.rules.iter().filter(|r| r.on).map(|r| (r.name.clone(), sched(&r.sched))).collect(),
        rules_off: st.data.rules.iter().filter(|r| !r.on).count(),
        foam_ids: foam, recent,
    })
}

#[tauri::command]
pub fn get_history(state: State<AppState>, drive: String) -> CmdResult<History90> {
    let st = lock(&state.store);
    let today = now_ms() / DAY_MS;
    let start_day = today - 90;
    let samples = st.data.history.get(&drive);
    let level = (0..=90).map(|i| samples.and_then(|h| h.get(&(start_day + i)).copied())).collect();
    let mut cleans = BTreeMap::new();
    let mut moves = BTreeMap::new();
    let mut rule_days = BTreeMap::new();
    for e in st.data.activity.iter().filter(|e| !e.undone) {
        let d = e.at / DAY_MS - start_day;
        if !(0..=90).contains(&d) {
            continue;
        }
        let gb: f64 = e.amount.trim_end_matches(" GB").parse().unwrap_or(0.0);
        match e.kind.as_str() {
            "clean" => { let c = cleans.entry(d as u32).or_insert(("清理".to_string(), 0.0)); c.1 += gb; }
            "move" => { moves.insert(d as u32, (e.title.clone(), gb)); }
            "rule" => { *rule_days.entry(d as u32).or_insert(0) += 1; }
            _ => {}
        }
    }
    Ok(History90 { level, cleans, moves, rule_days, start: start_day * DAY_MS })
}

// ---------------- rules, records, settings

#[tauri::command]
pub fn list_rules(state: State<AppState>) -> CmdResult<Vec<Rule>> {
    Ok(lock(&state.store).data.rules.clone())
}

#[tauri::command]
pub fn rule_templates() -> Vec<RuleTemplate> {
    store::templates()
}

#[tauri::command]
pub fn save_rule(state: State<AppState>, rule: Rule) -> CmdResult<()> {
    let mut st = lock(&state.store);
    match st.data.rules.iter_mut().find(|r| r.id == rule.id) {
        Some(r) => *r = rule,
        None => st.data.rules.push(rule),
    }
    st.save();
    Ok(())
}

#[tauri::command]
pub fn list_activity(state: State<AppState>) -> CmdResult<Vec<ActivityEvent>> {
    let st = lock(&state.store);
    // newest 500 entries is plenty for the page; the log itself keeps 90 days
    Ok(st.data.activity.iter().take(500).map(|e| ActivityEvent { day: day_label(e.at), time: hhmm(e.at), ..e.clone() }).collect())
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> CmdResult<Settings> {
    Ok(lock(&state.store).data.settings.clone())
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, patch: serde_json::Value) -> CmdResult<Settings> {
    let mut st = lock(&state.store);
    let mut cur = serde_json::to_value(&st.data.settings).map_err(|e| e.to_string())?;
    if let (Some(c), Some(p)) = (cur.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            c.insert(k.clone(), v.clone());
        }
    }
    let next: Settings = serde_json::from_value(cur).map_err(|e| format!("设置格式不对：{e}"))?;
    if !next.scan_root.trim().is_empty() && !sandbox::is_sandbox(std::path::Path::new(next.scan_root.trim())) {
        return Err(format!("{} 不是沙盒文件夹。扫描范围只能留空（整盘）或填 sandbox-gen 生成的沙盒", next.scan_root));
    }
    st.data.settings = next;
    st.save();
    Ok(st.data.settings.clone())
}

#[tauri::command]
pub fn open_path(path: String) -> CmdResult<()> {
    let expanded = crate::paths::expand_env(&path);
    std::process::Command::new("explorer.exe").arg(expanded).spawn().map_err(|e| format!("打不开资源管理器：{e}"))?;
    Ok(())
}

