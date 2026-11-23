//! Organising rules: parse the rule's conditions, preview (dry run) what they match, and run them.
//! Rules only look at the top level of the chosen folders, and only at names, types, sizes and times.
//! Actions: move to the Recycle Bin, or move into a folder (by year / month). Every write is guarded.

use crate::guard;
use crate::model::{Rule, Skipped};
use crate::recycle;
use crate::sandbox::Roots;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Recycle,
    /// base folder plus a sub path where 年 / 月 / 年份 / 年-月 are filled from the file's date
    MoveTo { base: PathBuf, sub: String },
}

#[derive(Debug, Clone)]
pub struct Spec {
    pub locs: Vec<PathBuf>,
    pub exts: Vec<String>,
    pub older_days: Option<u32>,
    pub min_bytes: Option<u64>,
    pub names: Vec<String>,
    pub empty_dirs: bool,
    pub action: Action,
}

fn folder(roots: &Roots, name: &str) -> Option<PathBuf> {
    let n = name.trim();
    if roots.sandbox {
        let rel = match n {
            "下载" => "Downloads", "桌面" => "Desktop", "文稿" | "文档" => "Documents", "图片" => "Pictures",
            "视频" => "Videos", "音乐" => "Music", "微信收到的文件" => "Documents\\WeChat Files",
            _ => return None,
        };
        return Some(roots.user.join(rel));
    }
    crate::paths::user_folder(n)
}

fn parse_size(v: &str) -> Option<u64> {
    let t = v.trim().to_uppercase();
    let (num, unit) = t.split_at(t.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap_or(t.len()));
    let x: f64 = num.trim().parse().ok()?;
    let mul = match unit.trim() { "GB" | "G" => 1u64 << 30, "MB" | "M" | "" => 1 << 20, "KB" | "K" => 1 << 10, _ => return None };
    Some((x * mul as f64) as u64)
}

/// Turn the rule's human-readable conditions into a spec. Unsupported conditions are an error:
/// a rule never runs on a guess.
pub fn parse(rule: &Rule, roots: &Roots) -> Result<Spec, String> {
    let mut s = Spec { locs: vec![], exts: vec![], older_days: None, min_bytes: None, names: vec![], empty_dirs: false, action: Action::Recycle };
    for (k, v) in &rule.when {
        match k.as_str() {
            "位置" => for part in v.split(['、', ',', '，']) {
                s.locs.push(folder(roots, part).ok_or_else(|| format!("不认识的位置「{part}」"))?);
            },
            "类型" => s.exts = v.split_whitespace().map(|e| e.trim_start_matches('.').to_lowercase()).filter(|e| !e.is_empty()).collect(),
            "早于" => s.older_days = Some(v.trim().trim_end_matches('天').trim().parse().map_err(|_| format!("「早于 {v}」看不懂"))?),
            "大于" => s.min_bytes = Some(parse_size(v).ok_or_else(|| format!("「大于 {v}」看不懂"))?),
            "名称包含" => s.names = v.split('/').map(|x| x.trim().to_lowercase()).filter(|x| !x.is_empty()).collect(),
            "条件" if v.trim() == "空文件夹" => s.empty_dirs = true,
            _ => return Err(format!("条件「{k} {v}」暂不支持，这条规则不会运行")),
        }
    }
    if s.locs.is_empty() {
        return Err("规则没有指定位置".into());
    }
    let act = rule.action.split('·').next().unwrap_or("").trim();
    s.action = if act.starts_with("移入回收站") || act.starts_with("删除空文件夹") {
        Action::Recycle
    } else if let Some(rest) = act.strip_prefix("移到").or_else(|| act.strip_prefix("迁移到")) {
        let rest = rest.trim();
        let (head, sub) = rest.split_once('\\').unwrap_or((rest, ""));
        let base = if head.len() == 2 && head.ends_with(':') { PathBuf::from(format!("{head}\\")) } else { folder(roots, head).ok_or_else(|| format!("不认识的目标「{head}」"))? };
        Action::MoveTo { base, sub: sub.to_string() }
    } else {
        return Err(format!("动作「{}」暂不支持", rule.action));
    };
    Ok(s)
}

fn mtime_ms(md: &fs::Metadata) -> i64 {
    md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// What the rule would touch right now: (path, bytes).
pub fn matches(s: &Spec) -> Vec<(PathBuf, u64)> {
    let now = crate::store::now_ms();
    let mut out = Vec::new();
    for loc in &s.locs {
        for e in fs::read_dir(loc).into_iter().flatten().flatten() {
            let p = e.path();
            let Ok(md) = fs::symlink_metadata(&p) else { continue };
            if md.file_type().is_symlink() { continue; }
            if s.empty_dirs {
                if md.is_dir() && fs::read_dir(&p).map(|mut d| d.next().is_none()).unwrap_or(false) { out.push((p, 0)); }
                continue;
            }
            if !md.is_file() { continue; }
            let name = e.file_name().to_string_lossy().to_lowercase();
            if name == "desktop.ini" { continue; }
            if !s.exts.is_empty() && !s.exts.iter().any(|x| name.ends_with(&format!(".{x}"))) { continue; }
            if !s.names.is_empty() && !s.names.iter().any(|n| name.contains(n)) { continue; }
            if let Some(d) = s.older_days && now - mtime_ms(&md) < d as i64 * 86_400_000 { continue; }
            if let Some(b) = s.min_bytes && md.len() < b { continue; }
            out.push((p, md.len()));
        }
    }
    out.sort();
    out
}

fn dest_for(base: &Path, sub: &str, file: &Path) -> PathBuf {
    let ms = fs::metadata(file).map(|m| mtime_ms(&m)).unwrap_or(0);
    let (y, m, _) = crate::timefmt::civil_from_days(crate::timefmt::local_day(ms));
    let sub = sub.replace("年-月", &format!("{y}-{m:02}")).replace("年份", &y.to_string()).replace('年', &y.to_string()).replace('月', &format!("{m:02}"));
    let dir = if sub.is_empty() { base.to_path_buf() } else { base.join(sub) };
    let name = file.file_name().unwrap_or_default();
    let mut to = dir.join(name);
    let mut n = 2;
    while to.exists() {
        let stem = Path::new(name).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let ext = Path::new(name).extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
        to = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    to
}

pub struct Outcome {
    pub recycled: Vec<(PathBuf, u64)>,
    pub moved: Vec<(PathBuf, PathBuf, u64)>,
    pub skipped: Vec<Skipped>,
}

/// Move a file: rename on the same volume; otherwise copy, verify, then recycle the original.
pub fn move_file(from: &Path, to: &Path, target: &Roots, app_data: &Path) -> Result<(), String> {
    if let Some(d) = to.parent() { fs::create_dir_all(d).map_err(|e| e.to_string())?; }
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(e) if e.raw_os_error() == Some(17) => {
            // different volume
            crate::migrate::copy_verified_pub(from, to)?;
            let o = recycle::recycle(&[from.to_path_buf()], target, app_data);
            if o.recycled.is_empty() { return Err(o.skipped.first().map(|s| s.reason.clone()).unwrap_or_default()); }
            Ok(())
        }
        Err(e) => Err(format!("没能移动：{e}")),
    }
}

pub fn run(s: &Spec, files: &[(PathBuf, u64)], target: &Roots, app_data: &Path) -> Outcome {
    let mut o = Outcome { recycled: vec![], moved: vec![], skipped: vec![] };
    match &s.action {
        Action::Recycle => {
            let paths: Vec<PathBuf> = files.iter().map(|f| f.0.clone()).collect();
            let r = recycle::recycle(&paths, target, app_data);
            o.recycled = r.recycled;
            o.skipped = r.skipped;
        }
        Action::MoveTo { base, sub } => {
            for (p, n) in files {
                let to = dest_for(base, sub, p);
                let name = p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
                if let Err(b) = guard::check_write(p, target, app_data).and_then(|_| guard::check_write(&to, target, app_data)) {
                    o.skipped.push(Skipped { name, reason: b.0 });
                    continue;
                }
                match move_file(p, &to, target, app_data) {
                    Ok(()) => o.moved.push((p.clone(), to, *n)),
                    Err(e) => o.skipped.push(Skipped { name, reason: e }),
                }
            }
        }
    }
    o
}

/// Put moved files back (only where the original spot is still free).
pub fn undo_moves(moved: &[(String, String)]) -> Vec<String> {
    let mut failed = Vec::new();
    for (from, to) in moved {
        let (f, t) = (Path::new(from), Path::new(to));
        if f.exists() || !t.exists() || fs::rename(t, f).is_err() {
            failed.push(from.clone());
        }
    }
    failed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{sandbox, store};

    fn rule(when: &[(&str, &str)], action: &str) -> Rule {
        Rule { id: "t".into(), name: "t".into(), on: false, sched: "day".into(), lv: "L2".into(), action: action.into(),
            when: when.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect(), last: String::new(), files: vec![], last_run: 0 }
    }

    #[test]
    fn default_rules_dry_run_and_run_in_the_sandbox() {
        let dir = crate::testutil::tmp();
        let root = dir.path().join("sb");
        sandbox::generate(&root).unwrap();
        let r = Roots::for_sandbox(&root);
        let app = dir.path().join("appdata");
        let rules = store::default_rules();

        // installers older than 30 days: cuda (180 d), Zoom (60 d), Git (45 d)
        let s = parse(&rules[0], &r).unwrap();
        let m = matches(&s);
        let names: Vec<String> = m.iter().map(|x| x.0.file_name().unwrap().to_string_lossy().to_string()).collect();
        assert_eq!(names, ["Git-2.47.0-64-bit.exe", "Zoom_6.2.4.exe", "cuda_12.4.0_windows.exe"]);

        // screenshots by month: one on the desktop, one in Pictures
        let s2 = parse(&rules[1], &r).unwrap();
        let m2 = matches(&s2);
        assert_eq!(m2.len(), 2);
        let o = run(&s2, &m2, &r, &app);
        assert_eq!(o.moved.len(), 2, "{:?}", o.skipped.iter().map(|s| &s.reason).collect::<Vec<_>>());
        for (from, to, _) in &o.moved {
            assert!(!from.exists() && to.exists());
            assert!(to.starts_with(r.user.join("Pictures").join("截图")), "{}", to.display());
        }
        assert!(matches(&s2).is_empty() || matches(&s2).iter().all(|(p, _)| p.starts_with(r.user.join("Pictures").join("截图"))) );
        let back: Vec<(String, String)> = o.moved.iter().map(|(f, t, _)| (f.to_string_lossy().to_string(), t.to_string_lossy().to_string())).collect();
        assert!(undo_moves(&back).is_empty());
        assert!(o.moved.iter().all(|(f, _, _)| f.exists()));
    }

    #[test]
    fn unsupported_conditions_never_run() {
        let r = Roots::for_sandbox(Path::new("D:\\nowhere"));
        assert!(parse(&rule(&[("位置", "下载"), ("条件", "对应应用已安装")], "移入回收站 · 可撤销"), &r).is_err());
        assert!(parse(&rule(&[("位置", "火星")], "移入回收站"), &r).is_err());
        assert!(parse(&rule(&[("位置", "下载")], "格式化硬盘"), &r).is_err());
        let s = parse(&rule(&[("位置", "下载、桌面"), ("大于", "2 GB"), ("早于", "7 天")], "移到 视频"), &r).unwrap();
        assert_eq!(s.min_bytes, Some(2 << 30));
        assert_eq!(s.older_days, Some(7));
        assert_eq!(s.locs.len(), 2);
    }
}
