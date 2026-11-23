//! Data shapes shared with the frontend (`src/services/types.ts`). Field names are camelCase on the wire.
//! Sizes are GB as f64 unless noted; times are ms since the Unix epoch.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub id: String,
    pub name: String,
    pub total: f64,
    pub free: f64,
    pub free30: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Leaf {
    pub id: String,
    pub cat: String,
    pub cat_name: String,
    pub name: String,
    pub short: String,
    pub xs: String,
    pub gb: f64,
    pub gain: f64,
    pub level: String,
    pub act: String,
    pub path_head: String,
    pub path_tail: String,
    pub note: String,
    pub cmd: String,
    pub meta: bool,
    #[serde(rename = "move")]
    pub move_id: String,
    pub rv: f64,
    pub actual: f64,
    #[serde(default)]
    pub cleaned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cat {
    pub id: String,
    pub name: String,
    pub short: String,
    pub items: Vec<String>,
    pub cl: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Move {
    pub id: String,
    pub name: String,
    pub cells: Vec<String>,
    pub frm: String,
    pub to: String,
    pub how: String,
    pub mins: String,
    pub link: bool,
    pub verify: String,
    pub steps: Vec<String>,
    pub generic: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapModel {
    pub drive: DriveInfo,
    pub leaves: Vec<Leaf>,
    pub cats: Vec<Cat>,
    pub moves: Vec<Move>,
    pub bin: f64,
    pub history30: Vec<f64>,
    pub scanned_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stats: Option<ScanStats>,
}

/// What the scan counted and what it left out.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStats {
    pub files: u64,
    /// folders / files that could not be read (no permission, in use)
    pub skipped: u64,
    /// online-only cloud files: not counted, never opened
    pub cloud_files: u64,
    pub cloud_gb: f64,
    /// extra paths to hard-linked files, counted once
    pub hardlinks: u64,
    pub took_sec: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanProgress {
    pub p: f64,
    pub phase: &'static str,
    pub files: u64,
    pub gb: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptItem {
    pub id: String,
    pub name: String,
    pub act: String,
    pub level: String,
    pub gb: f64,
    pub undoable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skipped {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Receipt {
    pub id: String,
    pub freed: f64,
    pub bin: f64,
    pub items: Vec<ReceiptItem>,
    pub skipped: Vec<Skipped>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationProgress {
    pub move_id: String,
    pub pct: f64,
    pub state: &'static str,
    pub drive: String,
    pub gb: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct MigrateOptions {
    pub link: bool,
    pub verify: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanRow {
    pub id: String,
    pub name: String,
    pub level: String,
    pub act: String,
    pub gain: f64,
    pub head: String,
    pub tail: String,
    pub note: String,
    pub cmd: String,
    pub meta: bool,
    pub last: String,
    pub days: u32,
    #[serde(default)]
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BigFile {
    pub id: String,
    pub name: String,
    pub dir: String,
    pub gb: f64,
    #[serde(rename = "type")]
    pub ftype: String,
    pub last: String,
    pub managed: String,
    pub act: Option<String>,
    pub kind: Option<String>,
    pub why: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DupCopy {
    pub dir: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DupGroup {
    pub id: String,
    pub name: String,
    pub each: f64,
    pub copies: Vec<DupCopy>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DupSelection {
    pub group_id: String,
    pub keep: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub id: String,
    pub name: String,
    pub on: bool,
    pub sched: String,
    pub lv: String,
    #[serde(rename = "do")]
    pub action: String,
    pub when: Vec<(String, String)>,
    pub last: String,
    pub files: Vec<(String, f64)>,
    /// ms epoch of the last run (scheduler)
    #[serde(default, rename = "lastRun")]
    pub last_run: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleTemplate {
    pub name: String,
    pub when: Vec<(String, String)>,
    #[serde(rename = "do")]
    pub action: String,
    pub lv: String,
    pub sched: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct RuleRun {
    pub n: usize,
    pub gb: f64,
    pub files: Vec<(String, f64)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityEvent {
    pub id: String,
    pub day: String,
    pub time: String,
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub amount: String,
    pub undo: String,
    pub items: Vec<(String, String, String)>,
    #[serde(default)]
    pub undone: bool,
    /// ms epoch, used to keep 90 days and to label "今天 / 昨天"
    #[serde(default)]
    pub at: i64,
    /// receipt to undo, when undoable
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipt: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Grower {
    pub name: String,
    pub lv: String,
    pub gb: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewData {
    pub growers: Vec<Grower>,
    pub grow_total: f64,
    pub grow_note: String,
    pub rule_runs: u32,
    pub rules_on: Vec<(String, String)>,
    pub rules_off: usize,
    pub foam_ids: Vec<String>,
    pub recent: Vec<(String, String, String, String)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct History90 {
    pub level: Vec<Option<f64>>,
    pub cleans: BTreeMap<u32, (String, f64)>,
    pub moves: BTreeMap<u32, (String, f64)>,
    pub rule_days: BTreeMap<u32, u32>,
    pub start: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub autostart: bool,
    pub sound: bool,
    pub daily: bool,
    pub recycle_first: bool,
    pub check_running: bool,
    pub skip_in_use: bool,
    pub low: bool,
    pub weekly: bool,
    pub inst: bool,
    pub close: String,
    pub bin: String,
    pub drives: BTreeMap<String, bool>,
    pub excl: Vec<String>,
    pub scan_root: String,
    /// scan only: every write (clean, recycle, migrate, rules) is refused by the backend
    pub read_only: bool,
    /// the first-run safety notice was answered
    pub ack_safety: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            autostart: false,
            sound: false,
            daily: false,
            recycle_first: true,
            check_running: true,
            skip_in_use: true,
            low: true,
            weekly: false,
            inst: false,
            close: "quit".into(),
            bin: "30".into(),
            drives: BTreeMap::new(),
            excl: Vec::new(),
            scan_root: String::new(),
            read_only: true,
            ack_safety: false,
        }
    }
}
