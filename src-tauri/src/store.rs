//! Local persistence in the app data folder (%APPDATA%\Strandline): settings, rules, the 90-day
//! activity log, daily free-space samples and undo receipts. Plain JSON files, written atomically.

use crate::model::{ActivityEvent, Receipt, Rule, RuleTemplate, Settings};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const DAY_MS: i64 = 86_400_000;

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// What undoing one receipt needs: where each recycled item came from.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UndoRecord {
    pub receipt: Receipt,
    /// receipt item id → original paths that went to the Recycle Bin
    pub recycled: BTreeMap<String, Vec<String>>,
    /// receipt item id → (from, to) moves done by a rule, undone by moving back
    #[serde(default)]
    pub moved: BTreeMap<String, Vec<(String, String)>>,
    pub at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Data {
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub rules: Vec<Rule>,
    #[serde(default)]
    pub activity: Vec<ActivityEvent>,
    /// drive → day index (days since epoch) → free GB
    #[serde(default)]
    pub history: BTreeMap<String, BTreeMap<i64, f64>>,
    #[serde(default)]
    pub undo: BTreeMap<String, UndoRecord>,
    /// drive → path → GB from the previous scan (for "30 天里涨得最多")
    #[serde(default)]
    pub sizes: BTreeMap<String, BTreeMap<String, (f64, i64)>>,
    #[serde(default)]
    pub seq: u64,
}

pub struct Store {
    dir: PathBuf,
    pub data: Data,
}

fn read_json<T: DeserializeOwned + Default>(p: &Path) -> T {
    fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn write_json<T: Serialize>(p: &Path, v: &T) -> std::io::Result<()> {
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(v)?)?;
    fs::rename(&tmp, p)
}

impl Store {
    /// Open the store in `dir` (created if needed). Missing or unreadable files start empty.
    pub fn open(dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&dir);
        let mut data: Data = read_json(&dir.join("strandline.json"));
        if data.rules.is_empty() {
            data.rules = default_rules();
        }
        Store { dir, data }
    }

    pub fn default_dir() -> PathBuf {
        dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("Strandline")
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn save(&self) {
        if let Err(e) = write_json(&self.dir.join("strandline.json"), &self.data) {
            log::warn!("could not save settings: {e}");
        }
    }

    pub fn next_id(&mut self, prefix: &str) -> String {
        self.data.seq += 1;
        format!("{prefix}{}", self.data.seq)
    }

    /// Record today's free space for a drive (one sample per day, latest wins).
    pub fn sample_free(&mut self, drive: &str, free_gb: f64) {
        let day = now_ms() / DAY_MS;
        let h = self.data.history.entry(drive.to_string()).or_default();
        h.insert(day, free_gb);
        let keep_from = day - 120;
        h.retain(|d, _| *d >= keep_from);
    }

    /// Free GB on `days_ago` (nearest earlier sample), if any.
    pub fn free_days_ago(&self, drive: &str, days_ago: i64) -> Option<f64> {
        let day = now_ms() / DAY_MS - days_ago;
        self.data.history.get(drive)?.range(..=day).next_back().map(|(_, v)| *v)
    }

    pub fn log(&mut self, mut e: ActivityEvent) -> String {
        e.id = self.next_id("e");
        e.at = now_ms();
        let id = e.id.clone();
        self.data.activity.insert(0, e);
        let cutoff = now_ms() - 90 * DAY_MS;
        self.data.activity.retain(|a| a.at >= cutoff);
        self.data.undo.retain(|_, u| u.at >= cutoff);
        id
    }
}

fn when(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

/// Built-in rules. All start disabled: nothing runs until the user has looked at the preview.
pub fn default_rules() -> Vec<Rule> {
    let r = |id: &str, name: &str, sched: &str, lv: &str, action: &str, w: &[(&str, &str)]| Rule {
        id: id.into(), name: name.into(), on: false, sched: sched.into(), lv: lv.into(), action: action.into(),
        when: when(w), last: "尚未运行".into(), files: vec![],
    };
    vec![
        r("r1", "安装包放了 30 天后移入回收站", "day", "L2", "移入回收站 · 可撤销", &[("位置", "下载"), ("类型", ".exe .msi"), ("早于", "30 天")]),
        r("r2", "截图按月归档", "new", "L4", "移到 图片\\截图\\年-月", &[("位置", "桌面、图片"), ("名称包含", "截图 / Screenshot"), ("类型", ".png .jpg")]),
        r("r3", "论文 PDF 归档", "new", "L4", "移到 文稿\\文献\\年份", &[("位置", "下载"), ("类型", ".pdf")]),
    ]
}

pub fn templates() -> Vec<RuleTemplate> {
    let t = |name: &str, w: &[(&str, &str)], action: &str, lv: &str, sched: &str| RuleTemplate {
        name: name.into(), when: when(w), action: action.into(), lv: lv.into(), sched: sched.into(),
    };
    vec![
        t("桌面文件每周收进「待整理」", &[("位置", "桌面"), ("早于", "7 天")], "移到 桌面\\待整理", "L4", "week"),
        t("压缩包放了 7 天后移入回收站", &[("位置", "下载"), ("类型", ".zip .7z"), ("早于", "7 天")], "移入回收站 · 可撤销", "L2", "day"),
        t("大于 2 GB 的视频移到「视频」", &[("位置", "下载、桌面"), ("类型", ".mp4 .mov .mkv"), ("大于", "2 GB")], "移到 视频", "L4", "week"),
        t("下载里的旧文件移入回收站", &[("位置", "下载"), ("早于", "180 天")], "移入回收站 · 可撤销", "L2", "month"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_round_trip_and_defaults() {
        let dir = tempfile::tempdir().unwrap();
        {
            let mut s = Store::open(dir.path().to_path_buf());
            assert_eq!(s.data.rules.len(), 3);
            assert!(s.data.rules.iter().all(|r| !r.on), "built-in rules must start disabled");
            s.data.settings.scan_root = "X:\\sandbox".into();
            s.sample_free("C", 42.0);
            s.save();
        }
        let s = Store::open(dir.path().to_path_buf());
        assert_eq!(s.data.settings.scan_root, "X:\\sandbox");
        assert_eq!(s.free_days_ago("C", 0), Some(42.0));
    }
}
