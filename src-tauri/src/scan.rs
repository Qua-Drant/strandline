//! Read-only parallel scan of a drive (or a sandbox folder).
//!
//! One pass with `jwalk` (directory reads run on a rayon pool) collects, for every directory, the
//! total size and newest modification time of its subtree, plus every file ≥ 1 MiB (for the
//! large-file and duplicate finders). Links and junctions are never followed, unreadable folders are
//! skipped, and progress is reported through a throttled callback so the UI never blocks.

use crate::guard;
use crate::sandbox::Roots;
use jwalk::{Parallelism, WalkDirGeneric};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const MIN_FILE: u64 = 1024 * 1024;

#[derive(Debug, Clone)]
pub struct FileRec {
    pub path: PathBuf,
    pub size: u64,
    /// ms epoch
    pub mtime: i64,
    pub atime: i64,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct DirStat {
    pub size: u64,
    pub newest: i64,
    pub files: u64,
}

#[derive(Debug)]
pub struct ScanResult {
    pub roots: Roots,
    /// lower-cased path → subtree totals
    pub dirs: HashMap<String, DirStat>,
    pub files: Vec<FileRec>,
    /// `node_modules` folders that are not inside another one
    pub node_modules: Vec<PathBuf>,
    /// Rust `target` folders next to a Cargo.toml
    pub cargo_targets: Vec<PathBuf>,
    pub total: u64,
    pub nfiles: u64,
    pub at: i64,
    pub took: Duration,
}

pub fn key(p: &Path) -> String {
    let s = p.to_string_lossy().to_lowercase();
    let s = s.trim_end_matches('\\');
    if s.len() == 2 && s.ends_with(':') { format!("{s}\\") } else { s.to_string() }
}

fn ms(t: std::io::Result<SystemTime>) -> i64 {
    t.ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

impl ScanResult {
    pub fn stat(&self, p: &Path) -> Option<DirStat> {
        self.dirs.get(&key(p)).copied()
    }
    pub fn size_of(&self, p: &Path) -> u64 {
        if let Some(d) = self.stat(p) {
            return d.size;
        }
        // a single file (sizes are only kept for ≥ 1 MiB files; fall back to metadata)
        std::fs::symlink_metadata(p).map(|m| if m.is_file() { m.len() } else { 0 }).unwrap_or(0)
    }
    pub fn newest_of(&self, p: &Path) -> i64 {
        self.stat(p).map(|d| d.newest).or_else(|| std::fs::metadata(p).ok().map(|m| ms(m.modified()))).unwrap_or(0)
    }
}

impl ScanResult {
    /// Forget a path after it was recycled or moved away: its bytes leave every ancestor's total.
    pub fn forget(&mut self, p: &Path) {
        let k = key(p);
        let bytes = self.stat(p).map(|d| d.size).unwrap_or_else(|| self.files.iter().find(|f| key(&f.path) == k).map(|f| f.size).unwrap_or(0));
        let prefix = format!("{k}\\");
        self.dirs.retain(|d, _| *d != k && !d.starts_with(&prefix));
        self.files.retain(|f| { let fk = key(&f.path); fk != k && !fk.starts_with(&prefix) });
        self.node_modules.retain(|x| !crate::paths::is_within(x, p));
        self.cargo_targets.retain(|x| !crate::paths::is_within(x, p));
        self.adjust_ancestors(p, -(bytes as i64));
        self.total = self.total.saturating_sub(bytes);
    }

    /// Count a path again after it was restored.
    pub fn add_tree(&mut self, p: &Path) {
        if !p.exists() { return; }
        let roots = self.roots.clone();
        if let Some(sub) = scan(p, &roots, &[], &AtomicBool::new(false), |_| {}) {
            let bytes = sub.total;
            for (k, v) in sub.dirs { self.dirs.insert(k, v); }
            if std::fs::metadata(p).map(|m| m.is_file()).unwrap_or(false) {
                let md = std::fs::metadata(p).unwrap();
                if md.len() >= MIN_FILE { self.files.push(FileRec { path: p.to_path_buf(), size: md.len(), mtime: ms(md.modified()), atime: ms(md.accessed()) }); }
                self.adjust_ancestors(p, md.len() as i64);
                self.total += md.len();
                return;
            }
            self.files.extend(sub.files);
            self.node_modules.extend(sub.node_modules);
            self.cargo_targets.extend(sub.cargo_targets);
            self.adjust_ancestors(p, bytes as i64);
            self.total += bytes;
        }
    }

    fn adjust_ancestors(&mut self, p: &Path, delta: i64) {
        let mut cur = p.parent();
        while let Some(a) = cur {
            if let Some(d) = self.dirs.get_mut(&key(a)) {
                d.size = (d.size as i64 + delta).max(0) as u64;
            }
            cur = a.parent();
        }
    }
}

pub struct Progress {
    pub files: u64,
    pub bytes: u64,
}

/// Walk `root`. `excluded` folders (lower-cased keys) are skipped. Returns None when cancelled.
pub fn scan(root: &Path, roots: &Roots, excluded: &[PathBuf], cancel: &AtomicBool, mut on_progress: impl FnMut(&Progress)) -> Option<ScanResult> {
    let started = Instant::now();
    let excl: Vec<String> = excluded.iter().map(|p| key(p)).collect();
    let roots_c = roots.clone();
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 16);
    let walker = WalkDirGeneric::<((), ())>::new(root)
        .skip_hidden(false)
        .follow_links(false)
        .parallelism(Parallelism::RayonNewPool(threads))
        .process_read_dir(move |_, path, _, children| {
            // drop excluded / system-noise folders before they are read
            children.retain(|c| match c {
                Ok(e) if e.file_type.is_dir() => {
                    let p = path.join(&e.file_name);
                    let k = key(&p);
                    !excl.iter().any(|x| k == *x || k.starts_with(&format!("{x}\\"))) && !guard::skip_when_scanning(&p, &roots_c)
                }
                Ok(_) => true,
                Err(_) => false,
            });
        });

    let mut own: HashMap<String, DirStat> = HashMap::new();
    let mut files = Vec::new();
    let mut node_modules = Vec::new();
    let mut cargo_targets = Vec::new();
    let mut nfiles = 0u64;
    let mut total = 0u64;
    let mut last = Instant::now();

    for entry in walker {
        if cancel.load(Ordering::Relaxed) {
            return None;
        }
        let Ok(e) = entry else { continue };
        let ft = e.file_type;
        let path = e.path();
        if ft.is_dir() {
            own.entry(key(&path)).or_default();
            if e.file_name == "node_modules" && !path.parent().map(|p| p.to_string_lossy().to_lowercase().contains("\\node_modules")).unwrap_or(false) {
                node_modules.push(path.clone());
            } else if e.file_name == "target" && path.parent().map(|p| p.join("Cargo.toml").exists()).unwrap_or(false) {
                cargo_targets.push(path.clone());
            }
            continue;
        }
        if !ft.is_file() {
            continue; // symlinks, junctions and other reparse points are not followed or counted
        }
        let Ok(md) = e.metadata() else { continue };
        let size = md.len();
        let mtime = ms(md.modified());
        nfiles += 1;
        total += size;
        if let Some(parent) = path.parent() {
            let d = own.entry(key(parent)).or_default();
            d.size += size;
            d.files += 1;
            d.newest = d.newest.max(mtime);
        }
        if size >= MIN_FILE {
            files.push(FileRec { path: path.clone(), size, mtime, atime: ms(md.accessed()) });
        }
        if last.elapsed() >= Duration::from_millis(150) {
            last = Instant::now();
            on_progress(&Progress { files: nfiles, bytes: total });
        }
    }

    // roll each folder's own totals up into all of its ancestors (deepest first)
    let mut keys: Vec<String> = own.keys().cloned().collect();
    keys.sort_by_key(|k| std::cmp::Reverse(k.matches('\\').count()));
    let root_key = key(root);
    let mut dirs = own;
    for k in keys {
        if k == root_key {
            continue;
        }
        let st = dirs[&k];
        if let Some(i) = k.trim_end_matches('\\').rfind('\\') {
            let parent = if i == 2 { k[..3].to_string() } else { k[..i].to_string() };
            let p = dirs.entry(parent).or_default();
            p.size += st.size;
            p.files += st.files;
            p.newest = p.newest.max(st.newest);
        }
    }
    on_progress(&Progress { files: nfiles, bytes: total });
    Some(ScanResult { roots: roots.clone(), dirs, files, node_modules, cargo_targets, total, nfiles, at: crate::store::now_ms(), took: started.elapsed() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox;

    #[test]
    fn scans_the_sandbox() {
        let dir = crate::testutil::tmp();
        let root = dir.path().join("sb");
        let g = sandbox::generate(&root).unwrap();
        let roots = Roots::for_sandbox(&root);
        let cancel = AtomicBool::new(false);
        let r = scan(&root, &roots, &[], &cancel, |_| {}).unwrap();
        assert_eq!(r.nfiles as usize, g.files + 1, "every generated file plus the marker");
        assert_eq!(r.total, g.logical_bytes + std::fs::metadata(root.join(sandbox::MARKER)).unwrap().len());
        assert_eq!(r.stat(&root).unwrap().size, r.total, "root total = sum of all files");
        let pip = roots.local.join("pip").join("Cache");
        assert_eq!(r.size_of(&pip), 6 * 60 * 1024 * 1024);
        assert_eq!(r.node_modules.len(), 1);
        assert_eq!(r.cargo_targets.len(), 1);
        assert!(r.files.iter().any(|f| f.path.ends_with("ubuntu-24.04-desktop-amd64.iso")));

        // forget / add back keep the totals right
        let mut r = r;
        let before = r.total;
        r.forget(&pip);
        assert_eq!(r.total, before - 6 * 60 * 1024 * 1024);
        assert_eq!(r.stat(&root).unwrap().size, r.total);
        assert!(r.stat(&pip).is_none());
        r.add_tree(&pip);
        assert_eq!(r.total, before);
        assert_eq!(r.stat(&root).unwrap().size, before);
    }

    #[test]
    fn excluded_folders_and_cancel() {
        let dir = crate::testutil::tmp();
        let root = dir.path().join("sb");
        sandbox::generate(&root).unwrap();
        let roots = Roots::for_sandbox(&root);
        let r = scan(&root, &roots, &[roots.user.join("Downloads")], &AtomicBool::new(false), |_| {}).unwrap();
        assert!(r.stat(&roots.user.join("Downloads")).is_none());
        assert!(!r.files.iter().any(|f| f.path.starts_with(roots.user.join("Downloads"))));
        assert!(scan(&root, &roots, &[], &AtomicBool::new(true), |_| {}).is_none());
    }
}
