//! Tauri commands called by `src/services/tauri/tauriService.ts`. Errors are returned as user-facing Chinese text.

use crate::drives;
use crate::model::*;
use crate::store::{self, now_ms, DAY_MS};
use crate::AppState;
use std::collections::BTreeMap;
use tauri::State;

pub type CmdResult<T> = Result<T, String>;

fn hhmm(ms: i64) -> String {
    // local wall-clock time; the offset comes from the OS via chrono-free arithmetic on the local tz is not
    // available in std, so the frontend formats real timestamps. Here we only need a short label.
    let secs = ms / 1000 + local_offset_secs();
    let m = (secs / 60).rem_euclid(60);
    let h = (secs / 3600).rem_euclid(24);
    format!("{h:02}:{m:02}")
}

/// Local UTC offset in seconds (Windows: from the time-zone bias).
pub fn local_offset_secs() -> i64 {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Time::{GetTimeZoneInformation, TIME_ZONE_INFORMATION};
        let mut tz: TIME_ZONE_INFORMATION = unsafe { std::mem::zeroed() };
        let r = unsafe { GetTimeZoneInformation(&mut tz) };
        let bias = tz.Bias + if r == 2 { tz.DaylightBias } else { tz.StandardBias };
        -(bias as i64) * 60
    }
    #[cfg(not(windows))]
    {
        0
    }
}

pub fn day_label(at: i64) -> String {
    let today = (now_ms() / 1000 + local_offset_secs()) / 86_400;
    let day = (at / 1000 + local_offset_secs()) / 86_400;
    match today - day {
        0 => "今天".into(),
        1 => "昨天".into(),
        _ => {
            let (_, m, d) = civil_from_days(day);
            format!("{m} 月 {d} 日")
        }
    }
}

/// Days since 1970-01-01 → (year, month, day) in the proleptic Gregorian calendar.
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ---------------- drives

#[tauri::command]
pub fn list_drives(state: State<AppState>) -> CmdResult<Vec<DriveInfo>> {
    let mut st = state.store.lock().map_err(|e| e.to_string())?;
    let list = drives::list(|d| st.free_days_ago(d, 30));
    log::info!("list_drives: {} drive(s)", list.len());
    for d in &list {
        st.sample_free(&d.id, d.free);
    }
    st.save();
    Ok(list)
}

// ---------------- rules

#[tauri::command]
pub fn list_rules(state: State<AppState>) -> CmdResult<Vec<Rule>> {
    Ok(state.store.lock().map_err(|e| e.to_string())?.data.rules.clone())
}

#[tauri::command]
pub fn rule_templates() -> Vec<RuleTemplate> {
    store::templates()
}

#[tauri::command]
pub fn save_rule(state: State<AppState>, rule: Rule) -> CmdResult<()> {
    let mut st = state.store.lock().map_err(|e| e.to_string())?;
    match st.data.rules.iter_mut().find(|r| r.id == rule.id) {
        Some(r) => *r = rule,
        None => st.data.rules.push(rule),
    }
    st.save();
    Ok(())
}

// ---------------- records & settings

#[tauri::command]
pub fn list_activity(state: State<AppState>) -> CmdResult<Vec<ActivityEvent>> {
    let st = state.store.lock().map_err(|e| e.to_string())?;
    Ok(st.data.activity.iter().map(|e| ActivityEvent { day: day_label(e.at), time: hhmm(e.at), ..e.clone() }).collect())
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> CmdResult<Settings> {
    Ok(state.store.lock().map_err(|e| e.to_string())?.data.settings.clone())
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, patch: serde_json::Value) -> CmdResult<Settings> {
    let mut st = state.store.lock().map_err(|e| e.to_string())?;
    let mut cur = serde_json::to_value(&st.data.settings).map_err(|e| e.to_string())?;
    if let (Some(c), Some(p)) = (cur.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            c.insert(k.clone(), v.clone());
        }
    }
    st.data.settings = serde_json::from_value(cur).map_err(|e| format!("设置格式不对：{e}"))?;
    st.save();
    Ok(st.data.settings.clone())
}

#[tauri::command]
pub fn get_history(state: State<AppState>, drive: String) -> CmdResult<History90> {
    let st = state.store.lock().map_err(|e| e.to_string())?;
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

#[tauri::command]
pub fn open_path(path: String) -> CmdResult<()> {
    let expanded = crate::paths::expand_env(&path);
    std::process::Command::new("explorer.exe").arg(expanded).spawn().map_err(|e| format!("打不开资源管理器：{e}"))?;
    Ok(())
}

// ---------------- pending: implemented in phase 2 (scan) and phase 3 (writes)

const PENDING: &str = "这个功能还在开发中";

#[tauri::command]
pub fn get_map_model(drive: String) -> CmdResult<MapModel> {
    let d = drives::list(|_| None).into_iter().find(|x| x.id == drive).ok_or("找不到这块磁盘")?;
    Ok(MapModel { drive: d, leaves: vec![], cats: vec![], moves: vec![], bin: 0.0, history30: vec![], scanned_at: "-".into() })
}
#[tauri::command]
pub fn scan_drive(_drive: String) -> CmdResult<MapModel> { Err(PENDING.into()) }
#[tauri::command]
pub fn cancel_scan() {}
#[tauri::command]
pub fn get_suggestions(_drive: String) -> Vec<CleanRow> { vec![] }
#[tauri::command]
pub fn clean_items(_drive: String, _ids: Vec<String>) -> CmdResult<Receipt> { Err(PENDING.into()) }
#[tauri::command]
pub fn undo_item(_receipt_id: String, _item_id: String) -> CmdResult<()> { Err(PENDING.into()) }
#[tauri::command]
pub fn undo_receipt(_receipt_id: String) -> CmdResult<()> { Err(PENDING.into()) }
#[tauri::command]
pub fn find_large(_drive: String) -> Vec<BigFile> { vec![] }
#[tauri::command]
pub fn recycle_files(_ids: Vec<String>) -> CmdResult<Receipt> { Err(PENDING.into()) }
#[tauri::command]
pub fn find_duplicates(_drive: String) -> Vec<DupGroup> { vec![] }
#[tauri::command]
pub fn recycle_duplicates(_sel: Vec<DupSelection>) -> CmdResult<Receipt> { Err(PENDING.into()) }
#[tauri::command]
pub fn start_migration(_move_id: String, _to: String, _opts: MigrateOptions) -> CmdResult<()> { Err(PENDING.into()) }
#[tauri::command]
pub fn resume_migration(_move_id: String) -> CmdResult<()> { Err(PENDING.into()) }
#[tauri::command]
pub fn dry_run_rule(_id: String) -> RuleRun { RuleRun::default() }
#[tauri::command]
pub fn run_rule(_id: String) -> CmdResult<serde_json::Value> { Err(PENDING.into()) }
#[tauri::command]
pub fn undo_activity(_id: String) -> CmdResult<()> { Err(PENDING.into()) }
#[tauri::command]
pub fn get_overview(state: State<AppState>, _drive: String) -> CmdResult<OverviewData> {
    let st = state.store.lock().map_err(|e| e.to_string())?;
    Ok(OverviewData {
        growers: vec![], grow_total: 0.0, grow_note: String::new(), rule_runs: 0,
        rules_on: st.data.rules.iter().filter(|r| r.on).map(|r| (r.name.clone(), r.sched.clone())).collect(),
        rules_off: st.data.rules.iter().filter(|r| !r.on).count(), foam_ids: vec![], recent: vec![],
    })
}
