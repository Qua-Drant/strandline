//! Verified folder migration with resume.
//!
//! 1. guard both ends, refuse links, check the target volume has room
//! 2. copy file by file in chunks; hash the source while reading (BLAKE3), write to `name.part`,
//!    fsync, read the copy back and compare hashes, then rename into place and record the file in
//!    a journal next to the target — an interrupted run resumes from the journal
//! 3. optionally re-read every copied file once more
//! 4. rename the source to `<name>.strandline-old`, create a directory junction at the old path
//!    pointing to the new folder, and check the data is reachable through it (rolled back if not)
//! 5. move the backup to the Recycle Bin; if the bin cannot hold it, keep it and say where
//!
//! The source is never deleted before the copy is verified, and nothing is ever deleted
//! permanently: at worst a complete, verified copy exists in both places.

use crate::guard;
use crate::paths::is_within;
use crate::recycle;
use crate::sandbox::Roots;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const CHUNK: usize = 4 << 20;

pub struct Job {
    pub src: PathBuf,
    pub dst: PathBuf,
    pub link: bool,
    pub verify: bool,
    /// process names that must not be running (lower-case, e.g. "ollama.exe")
    pub apps: Vec<String>,
    pub app_label: String,
}

pub struct Control {
    pub paused: AtomicBool,
    pub cancel: AtomicBool,
}

impl Default for Control {
    fn default() -> Self {
        Control { paused: AtomicBool::new(false), cancel: AtomicBool::new(false) }
    }
}

#[derive(Debug, PartialEq)]
pub enum Event {
    Progress(f64),
    /// paused at pct, with the reason
    Paused(f64, String),
    Done(Finish),
}

#[derive(Debug, PartialEq)]
pub struct Finish {
    pub bytes: u64,
    /// backup kept on disk because the Recycle Bin could not take it
    pub kept_backup: Option<PathBuf>,
    /// backup path that went to the Recycle Bin (for undo)
    pub recycled_backup: Option<PathBuf>,
    pub linked: bool,
}

/// Environment probes, injectable for tests.
pub struct Probes<'a> {
    pub free_bytes: &'a (dyn Fn(&Path) -> u64 + Sync),
    pub running: &'a (dyn Fn(&[String]) -> bool + Sync),
}

#[derive(Default, Serialize, Deserialize)]
struct Journal {
    src: String,
    dst: String,
    /// relative path → (size, hash hex)
    done: BTreeMap<String, (u64, String)>,
}

pub fn journal_path(dst: &Path) -> PathBuf {
    let name = dst.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    dst.with_file_name(format!(".{name}.strandline-migrate.json"))
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn is_reparse(p: &Path) -> bool {
    fs::symlink_metadata(p).map(|m| m.file_type().is_symlink()).unwrap_or(false) || {
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            fs::symlink_metadata(p).map(|m| m.file_attributes() & 0x400 != 0).unwrap_or(false)
        }
        #[cfg(not(windows))]
        {
            false
        }
    }
}

#[cfg(windows)]
fn is_sparse(p: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    fs::metadata(p).map(|m| m.file_attributes() & 0x200 != 0).unwrap_or(false)
}
#[cfg(not(windows))]
fn is_sparse(_: &Path) -> bool {
    false
}

#[cfg(windows)]
fn make_sparse(f: &File) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::IO::DeviceIoControl;
    use windows_sys::Win32::System::Ioctl::FSCTL_SET_SPARSE;
    let mut ret = 0u32;
    unsafe { DeviceIoControl(f.as_raw_handle() as _, FSCTL_SET_SPARSE, std::ptr::null(), 0, std::ptr::null_mut(), 0, &mut ret, std::ptr::null_mut()) };
}
#[cfg(not(windows))]
fn make_sparse(_: &File) {}

fn hash_file(p: &Path) -> std::io::Result<[u8; 32]> {
    let mut f = File::open(p)?;
    let mut h = blake3::Hasher::new();
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 { break; }
        h.update(&buf[..n]);
    }
    Ok(*h.finalize().as_bytes())
}

/// Copy one file and prove the copy: hash while reading the source, fsync, re-read the copy.
fn copy_verified(src: &Path, dst: &Path, cancel: &AtomicBool, mut on_bytes: impl FnMut(u64)) -> Result<String, String> {
    if crate::winfs::is_cloud(src) {
        return Err(format!("{} 只在云端，没有复制（避免触发下载）", src.display()));
    }
    let part = dst.with_file_name(format!("{}.part", dst.file_name().unwrap().to_string_lossy()));
    let mut r = File::open(src).map_err(|e| format!("读不了 {}：{e}", src.display()))?;
    let len = r.metadata().map(|m| m.len()).unwrap_or(0);
    let mut w = File::create(&part).map_err(|e| format!("写不了 {}：{e}", part.display()))?;
    let sparse = is_sparse(src);
    if sparse { make_sparse(&w); }
    let mut h = blake3::Hasher::new();
    let mut buf = vec![0u8; CHUNK];
    loop {
        if cancel.load(Ordering::Relaxed) {
            drop(w);
            let _ = fs::remove_file(&part);
            return Err("已停止".into());
        }
        let n = r.read(&mut buf).map_err(|e| format!("读 {} 时出错：{e}", src.display()))?;
        if n == 0 { break; }
        h.update(&buf[..n]);
        if sparse && buf[..n].iter().all(|&b| b == 0) {
            w.seek(SeekFrom::Current(n as i64)).map_err(|e| e.to_string())?;
        } else {
            w.write_all(&buf[..n]).map_err(|e| format!("写 {} 时出错：{e}", part.display()))?;
        }
        on_bytes(n as u64);
    }
    w.set_len(len).map_err(|e| e.to_string())?;
    w.sync_all().map_err(|e| format!("落盘失败：{e}"))?;
    if let Ok(t) = fs::metadata(src).and_then(|m| m.modified()) {
        let _ = w.set_times(fs::FileTimes::new().set_modified(t));
    }
    drop(w);
    let want = *h.finalize().as_bytes();
    let got = hash_file(&part).map_err(|e| format!("读回副本失败：{e}"))?;
    if got != want {
        let _ = fs::remove_file(&part);
        return Err(format!("{} 复制后校验和不一致，已丢弃这份副本", src.display()));
    }
    fs::rename(&part, dst).map_err(|e| format!("整理副本失败：{e}"))?;
    Ok(hex(&want))
}

/// Copy one file with the same verification (used by rules moving across volumes).
pub fn copy_verified_pub(src: &Path, dst: &Path) -> Result<(), String> {
    copy_verified(src, dst, &AtomicBool::new(false), |_| {}).map(|_| ())
}

/// Check the job before anything is written.
pub fn preflight(job: &Job, target: &Roots, app_data: &Path, probes: &Probes) -> Result<u64, String> {
    let (src, dst) = (&job.src, &job.dst);
    guard::check_write(src, target, app_data).map_err(|b| format!("源文件夹不能迁移：{b}"))?;
    if !dst.is_absolute() || dst.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("目标必须是完整路径".into());
    }
    if let Err(b) = guard::check_write(dst, target, app_data)
        && !(target.sandbox && b.0.contains("根文件夹")) { return Err(format!("目标位置不行：{b}")); }
    if is_within(dst, src) || is_within(src, dst) {
        return Err("目标不能在源文件夹里面（或反过来）".into());
    }
    if is_reparse(src) {
        return Err(format!("{} 已经是一个链接（可能已经迁移过）", src.display()));
    }
    if !src.is_dir() {
        return Err(format!("找不到 {}", src.display()));
    }
    let src_drive = src.to_string_lossy().chars().next().map(|c| c.to_ascii_uppercase());
    let dst_drive = dst.to_string_lossy().chars().next().map(|c| c.to_ascii_uppercase());
    if !target.sandbox && src_drive == dst_drive {
        return Err("目标还在同一块磁盘上，迁移不会腾出空间".into());
    }
    let mut total = 0u64;
    for e in jwalk::WalkDir::new(src).follow_links(false).skip_hidden(false) {
        let e = e.map_err(|e| format!("读不了源文件夹：{e}"))?;
        if e.file_type.is_symlink() || (e.depth > 0 && is_reparse(&e.path())) {
            return Err(format!("{} 里有链接或联接，暂不支持自动迁移", e.path().display()));
        }
        if e.file_type.is_file() {
            if crate::winfs::is_cloud(&e.path()) {
                return Err(format!("{} 只在云端（OneDrive 等的在线文件），复制会触发下载，暂不支持迁移这个文件夹", e.path().display()));
            }
            total += e.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    let journal: Journal = fs::read(journal_path(dst)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let already: u64 = journal.done.values().map(|v| v.0).sum();
    // a journal for this same source means an interrupted run we can resume
    let resumable = journal_path(dst).exists() && Path::new(&journal.src) == src.as_path();
    if dst.exists() && fs::read_dir(dst).map(|mut d| d.next().is_some()).unwrap_or(false) && !resumable {
        return Err(format!("{} 已经存在且不是空文件夹", dst.display()));
    }
    let need = total.saturating_sub(already) + total / 100 + (256 << 20);
    let probe = dst.ancestors().find(|a| a.exists()).unwrap_or(dst);
    if (probes.free_bytes)(probe) < need {
        return Err(format!("目标磁盘剩余空间不够（需要约 {:.1} GB）", need as f64 / 1073741824.0));
    }
    Ok(total)
}

/// Run (or resume) a migration. `emit` receives progress; returns the result when finished.
pub fn run(job: &Job, target: &Roots, app_data: &Path, ctl: &Control, probes: &Probes, mut emit: impl FnMut(Event)) -> Result<Finish, String> {
    let total = preflight(job, target, app_data, probes)?.max(1);
    let (src, dst) = (&job.src, &job.dst);
    let jpath = journal_path(dst);
    let mut journal: Journal = fs::read(&jpath).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    journal.src = src.to_string_lossy().to_string();
    journal.dst = dst.to_string_lossy().to_string();
    fs::create_dir_all(dst).map_err(|e| format!("建不了目标文件夹：{e}"))?;
    // write the journal before anything else lands in the target, so any interruption is resumable
    let _ = fs::write(&jpath, serde_json::to_vec(&journal).unwrap_or_default());

    let wait_if_running = |pct: f64, emit: &mut dyn FnMut(Event)| -> Result<(), String> {
        let mut announced = false;
        while (probes.running)(&job.apps) || ctl.paused.load(Ordering::Relaxed) {
            if !announced {
                ctl.paused.store(true, Ordering::Relaxed);
                emit(Event::Paused(pct, format!("{} 正在运行，迁移已暂停", job.app_label)));
                announced = true;
            }
            if ctl.cancel.load(Ordering::Relaxed) { return Err("已停止".into()); }
            std::thread::sleep(Duration::from_millis(250));
            // stay paused until the user presses 重试 (clears `paused`) and the app is closed
            if !ctl.paused.load(Ordering::Relaxed) && (probes.running)(&job.apps) {
                ctl.paused.store(true, Ordering::Relaxed);
                emit(Event::Paused(pct, format!("{} 还在运行，请先退出再重试", job.app_label)));
            }
        }
        Ok(())
    };
    wait_if_running(0.0, &mut emit)?;

    let mut files: Vec<PathBuf> = jwalk::WalkDir::new(src).follow_links(false).skip_hidden(false).sort(true).into_iter().flatten()
        .filter(|e| e.file_type.is_file()).map(|e| e.path()).collect();
    files.sort();
    let mut done_bytes: u64 = 0;
    let mut last_emit = Instant::now();
    let mut last_check = Instant::now();
    let save = |j: &Journal| { let _ = fs::write(&jpath, serde_json::to_vec(j).unwrap_or_default()); };

    // empty folders too
    for e in jwalk::WalkDir::new(src).follow_links(false).skip_hidden(false).into_iter().flatten().filter(|e| e.file_type.is_dir()) {
        let rel = e.path().strip_prefix(src).map(|p| p.to_path_buf()).unwrap_or_default();
        let _ = fs::create_dir_all(dst.join(rel));
    }
    for f in &files {
        let rel = f.strip_prefix(src).map_err(|e| e.to_string())?.to_string_lossy().to_string();
        let size = fs::metadata(f).map(|m| m.len()).unwrap_or(0);
        let out = dst.join(&rel);
        if let Some((s, _)) = journal.done.get(&rel)
            && *s == size && fs::metadata(&out).map(|m| m.len() == size).unwrap_or(false) {
                done_bytes += size;
                continue;
            }
        if last_check.elapsed() > Duration::from_secs(2) {
            last_check = Instant::now();
            wait_if_running(done_bytes as f64 / total as f64 * 90.0, &mut emit)?;
        }
        if let Some(d) = out.parent() { fs::create_dir_all(d).map_err(|e| e.to_string())?; }
        let base = done_bytes;
        let mut copied = 0u64;
        let hash = copy_verified(f, &out, &ctl.cancel, |n| {
            copied += n;
            if last_emit.elapsed() > Duration::from_millis(150) {
                last_emit = Instant::now();
                emit(Event::Progress((base + copied) as f64 / total as f64 * 90.0));
            }
        }).inspect_err(|_| save(&journal))?;
        done_bytes += size;
        journal.done.insert(rel, (size, hash));
        save(&journal);
    }
    emit(Event::Progress(90.0));

    if job.verify {
        for (i, (rel, (_, h))) in journal.done.iter().enumerate() {
            if ctl.cancel.load(Ordering::Relaxed) { return Err("已停止".into()); }
            let got = hash_file(&dst.join(rel)).map_err(|e| format!("复查 {rel} 失败：{e}"))?;
            if hex(&got) != *h {
                return Err(format!("复查发现 {rel} 和原件不一致，原文件夹没动"));
            }
            if i % 16 == 0 { emit(Event::Progress(90.0 + 6.0 * i as f64 / journal.done.len().max(1) as f64)); }
        }
    }

    // switch: keep the original as a backup, point the old path at the new folder
    wait_if_running(96.0, &mut emit)?;
    let mut backup = src.with_file_name(format!("{}.strandline-old", src.file_name().unwrap().to_string_lossy()));
    let mut n = 2;
    while backup.exists() {
        backup = src.with_file_name(format!("{}.strandline-old{n}", src.file_name().unwrap().to_string_lossy()));
        n += 1;
    }
    // another program (an editor, a file watcher, antivirus) may hold the folder open: pause and let
    // the user retry instead of failing — the verified copy is already complete
    while let Err(e) = rename_retry(src, &backup) {
        ctl.paused.store(true, Ordering::Relaxed);
        emit(Event::Paused(96.0, format!("有程序正在使用原文件夹，暂时不能切换（{e}）。新位置已有校验过的完整副本，关掉相关程序后点重试")));
        while ctl.paused.load(Ordering::Relaxed) {
            if ctl.cancel.load(Ordering::Relaxed) { return Err("已停止，原文件夹没动，新位置的副本保留".into()); }
            std::thread::sleep(Duration::from_millis(250));
        }
    }
    if job.link {
        let linked = junction::create(dst, src).map_err(|e| e.to_string()).and_then(|_| {
            // prove the data is reachable through the old path
            let probe = journal.done.keys().next().cloned();
            match probe {
                Some(rel) if !src.join(&rel).exists() => Err("通过原路径读不到文件".to_string()),
                _ => Ok(()),
            }
        });
        if let Err(e) = linked {
            let _ = junction::delete(src).or_else(|_| fs::remove_dir(src));
            fs::rename(&backup, src).map_err(|e2| format!("建立联接失败（{e}），而且没能把原文件夹改回名字（{e2}）。原数据在 {}", backup.display()))?;
            return Err(format!("建立目录联接失败，已恢复原样：{e}"));
        }
    }
    emit(Event::Progress(98.0));
    let _ = fs::remove_file(&jpath);

    // backup → Recycle Bin (kept on disk if the bin cannot hold it)
    let o = recycle::recycle(std::slice::from_ref(&backup), target, app_data);
    let (kept, recycled) = if o.recycled.is_empty() { (Some(backup), None) } else { (None, Some(backup)) };
    emit(Event::Progress(100.0));
    Ok(Finish { bytes: done_bytes, kept_backup: kept, recycled_backup: recycled, linked: job.link })
}

/// Rename, retrying for a few seconds: antivirus and the search indexer briefly hold files that
/// were just read, which makes a folder rename fail with "access denied".
fn rename_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut wait = 100;
    for _ in 0..8 {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied || e.raw_os_error() == Some(32) => {
                std::thread::sleep(Duration::from_millis(wait));
                wait = (wait * 2).min(2000);
            }
            Err(e) => return Err(e),
        }
    }
    fs::rename(from, to)
}

/// Undo a finished migration: remove the junction and put the original folder back.
/// The copy at the new location is left in place (nothing is deleted).
pub fn undo(src: &Path, backup: &Path, from_bin: bool) -> Result<(), String> {
    if from_bin {
        let missing = recycle::restore(&[backup.to_path_buf()])?;
        if !missing.is_empty() { return Err(format!("回收站里找不到 {}", backup.display())); }
    }
    if !backup.exists() {
        return Err(format!("找不到备份 {}", backup.display()));
    }
    if is_reparse(src) {
        junction::delete(src).map_err(|e| format!("删不掉联接：{e}"))?;
        let _ = fs::remove_dir(src);
    } else if src.exists() {
        return Err(format!("{} 已经有内容，没有覆盖", src.display()));
    }
    rename_retry(backup, src).map_err(|e| format!("没能把原文件夹放回去：{e}"))
}

/// Running process names, lower-cased.
pub fn running(names: &[String]) -> bool {
    if names.is_empty() { return false; }
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    sys.processes().values().any(|p| names.iter().any(|n| p.name().to_string_lossy().eq_ignore_ascii_case(n)))
}

pub fn free_bytes(p: &Path) -> u64 {
    let s = p.to_string_lossy().to_uppercase();
    crate::drives::raw_drives().into_iter().find(|d| s.starts_with(&format!("{}:", d.0))).map(|d| (d.3 * crate::drives::GB) as u64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox;
    use std::sync::atomic::AtomicUsize;

    fn setup() -> (tempfile::TempDir, Roots, PathBuf) {
        let dir = crate::testutil::tmp();
        let root = dir.path().join("sb");
        sandbox::generate(&root).unwrap();
        // a few real-content files so the hashes mean something
        let models = Roots::for_sandbox(&root).user.join(".ollama").join("models");
        for i in 0..6u8 {
            let p = models.join("blobs").join(format!("real{i}"));
            fs::write(&p, vec![i.wrapping_mul(37); 3 * 1024 * 1024 + i as usize]).unwrap();
        }
        fs::create_dir_all(models.join("empty-dir")).unwrap();
        let app = dir.path().join("appdata");
        (dir, Roots::for_sandbox(&root), app)
    }

    fn job(r: &Roots) -> Job {
        Job { src: r.user.join(".ollama").join("models"), dst: r.drive.join("_moved").join("models"), link: true, verify: true, apps: vec!["ollama.exe".into()], app_label: "Ollama".into() }
    }

    fn tree_hashes(p: &Path) -> BTreeMap<String, String> {
        jwalk::WalkDir::new(p).follow_links(false).into_iter().flatten().filter(|e| e.file_type.is_file())
            .map(|e| (e.path().strip_prefix(p).unwrap().to_string_lossy().to_string(), hex(&hash_file(&e.path()).unwrap()))).collect()
    }

    #[test]
    fn migrates_links_and_undoes() {
        let (_d, r, app) = setup();
        let j = job(&r);
        let before = tree_hashes(&j.src);
        let probes = Probes { free_bytes: &|_| u64::MAX, running: &|_| false };
        let mut events = Vec::new();
        let fin = run(&j, &r, &app, &Control::default(), &probes, |e| events.push(e)).unwrap();
        assert!(fin.linked && fin.recycled_backup.is_some());
        assert!(is_reparse(&j.src), "old path is now a junction");
        assert_eq!(tree_hashes(&j.dst), before, "copy is identical");
        assert_eq!(tree_hashes(&j.src), before, "readable through the old path");
        assert!(j.dst.join("empty-dir").is_dir());
        assert!(!journal_path(&j.dst).exists());
        assert!(matches!(events.last(), Some(Event::Progress(p)) if *p == 100.0));
        // the new copy of a sparse file stays sparse
        assert!(is_sparse(&j.dst.join("blobs").join("sha256-6a0746a1ec1a")));

        undo(&j.src, fin.recycled_backup.as_ref().unwrap(), true).unwrap();
        assert!(!is_reparse(&j.src) && tree_hashes(&j.src) == before, "original back in place");
        assert_eq!(tree_hashes(&j.dst), before, "copy left alone");
    }

    #[test]
    fn interrupted_copy_resumes_from_the_journal() {
        let (_d, r, app) = setup();
        let j = job(&r);
        let before = tree_hashes(&j.src);
        let probes = Probes { free_bytes: &|_| u64::MAX, running: &|_| false };
        let ctl = Control::default();
        let n = AtomicUsize::new(0);
        // stop part-way through the copy
        let err = run(&j, &r, &app, &ctl, &probes, |e| { if matches!(e, Event::Progress(_)) && n.fetch_add(1, Ordering::Relaxed) == 2 { ctl.cancel.store(true, Ordering::Relaxed); } }).unwrap_err();
        assert_eq!(err, "已停止");
        assert!(j.src.is_dir() && !is_reparse(&j.src), "source untouched after an interruption");
        assert_eq!(tree_hashes(&j.src), before);
        let journal: Journal = serde_json::from_slice(&fs::read(journal_path(&j.dst)).unwrap()).unwrap();
        assert!(!journal.done.is_empty() && journal.done.len() < before.len(), "partial journal: {}", journal.done.len());
        assert!(!fs::read_dir(j.dst.join("blobs")).unwrap().flatten().any(|e| e.file_name().to_string_lossy().ends_with(".part")), "no half-written files");

        let fin = run(&j, &r, &app, &Control::default(), &probes, |_| {}).unwrap();
        assert!(fin.linked);
        assert_eq!(tree_hashes(&j.src), before);
    }

    #[test]
    fn pauses_while_the_app_runs_and_refuses_unsafe_jobs() {
        let (_d, r, app) = setup();
        let j = job(&r);
        let ctl = Control::default();
        let calls = AtomicUsize::new(0);
        // "Ollama" runs for the first few checks, then quits; the user presses 重试 when paused
        let running = |_: &[String]| calls.fetch_add(1, Ordering::Relaxed) < 3;
        let probes = Probes { free_bytes: &|_| u64::MAX, running: &running };
        let mut paused = 0;
        run(&j, &r, &app, &ctl, &probes, |e| if let Event::Paused(_, m) = e { paused += 1; assert!(m.contains("Ollama")); ctl.paused.store(false, Ordering::Relaxed); }).unwrap();
        assert!(paused >= 1);

        let tight = Probes { free_bytes: &|_| 1024, running: &|_| false };
        let j2 = Job { src: r.user.join("Datasets"), dst: r.drive.join("_moved").join("Datasets"), ..job(&r) };
        assert!(run(&j2, &r, &app, &Control::default(), &tight, |_| {}).unwrap_err().contains("空间不够"));
        let bad = Job { src: r.windows.clone(), dst: r.drive.join("_moved").join("Windows"), ..job(&r) };
        assert!(preflight(&bad, &r, &app, &tight).unwrap_err().contains("不能迁移"));
        let inside = Job { src: r.user.join("Datasets"), dst: r.user.join("Datasets").join("x"), ..job(&r) };
        assert!(preflight(&inside, &r, &app, &Probes { free_bytes: &|_| u64::MAX, running: &|_| false }).is_err());
    }
}

