//! Large-file listing and duplicate detection over the files collected by the last scan.
//!
//! Duplicates: group by exact size → hash the first and last 64 KiB (BLAKE3) → full BLAKE3 hash of
//! the survivors. Each stage runs in parallel and only on files that are still candidates, so the
//! expensive full read happens only for files that are very likely identical.

use crate::model::{BigFile, DupCopy, DupGroup};
use crate::paths::{display, is_within};
use crate::sandbox::Roots;
use crate::scan::FileRec;
use crate::timefmt::{ago, ymd};
use rayon::prelude::*;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

pub const LARGE_MIN: u64 = 1024 * 1024 * 1024;
pub const DUP_MIN: u64 = 1024 * 1024;
const EDGE: u64 = 64 * 1024;
const GB: f64 = 1024.0 * 1024.0 * 1024.0;

fn ext(p: &Path) -> String {
    p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn ftype(p: &Path) -> &'static str {
    let s = p.to_string_lossy().to_lowercase();
    match ext(p).as_str() {
        "mp4" | "mov" | "mkv" | "avi" | "wmv" | "flv" | "webm" | "m4v" | "ts" => "video",
        "iso" | "img" | "vhd" | "vhdx" | "vmdk" | "qcow2" | "wim" | "esd" => "img",
        "safetensors" | "gguf" | "pt" | "pth" | "ckpt" | "onnx" | "h5" if !s.contains("dataset") => "model",
        "exe" | "msi" | "msix" | "appx" => "inst",
        "zip" | "7z" | "rar" | "tar" | "gz" | "tgz" | "bz2" | "xz" | "zst" => "zip",
        "sys" => "sys",
        _ if s.contains("\\.ollama\\") || s.contains("\\huggingface\\") => "model",
        _ => "data",
    }
}

/// Large files (≥ 1 GiB). Returns the rows plus id → path for later actions.
pub fn large(files: &[FileRec], roots: &Roots) -> (Vec<BigFile>, HashMap<String, PathBuf>) {
    let mut v: Vec<&FileRec> = files.iter().filter(|f| f.size >= LARGE_MIN).collect();
    v.sort_by_key(|f| std::cmp::Reverse(f.size));
    let mut ids = HashMap::new();
    let rows = v.into_iter().enumerate().map(|(i, f)| {
        let id = format!("f{i}");
        ids.insert(id.clone(), f.path.clone());
        let name = f.path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let lname = name.to_lowercase();
        let lp = f.path.to_string_lossy().to_lowercase();
        let gb = f.size as f64 / GB;
        let (managed, act, kind, why): (&str, Option<String>, Option<&str>, Option<&str>) =
            if lname == "pagefile.sys" || lname == "swapfile.sys" {
                ("系统文件", Some("打开虚拟内存设置".into()), Some("vm"), Some("Windows 虚拟内存，系统按需自动管理"))
            } else if lname == "hiberfil.sys" {
                ("系统文件", Some(format!("关闭休眠可腾出 {gb:.1} GB")), Some("hiber"), Some("休眠功能使用的文件，关闭休眠后会自动删除"))
            } else if lp.contains("\\docker\\") && lname.ends_with(".vhdx") {
                ("由 Docker 管理", Some("在空间地图中清理或迁移".into()), Some("map"), Some("Docker 镜像和容器都在这块虚拟磁盘里，需在 Docker 内清理后再压缩"))
            } else if lname == "ext4.vhdx" {
                ("由 WSL 管理", Some("在空间地图中迁移".into()), Some("map"), Some("Linux 子系统的整块磁盘，可以整体迁移到其他盘"))
            } else if lp.contains("\\.ollama\\") {
                ("由 Ollama 管理", Some("复制 ollama rm 命令".into()), Some("copy"), Some("本地模型文件，需用 Ollama 自己删除"))
            } else if is_within(&f.path, &roots.windows) || is_within(&f.path, &roots.drive.join("Program Files")) || is_within(&f.path, &roots.drive.join("Program Files (x86)")) {
                ("系统文件", None, None, Some("属于 Windows 或已安装的应用，不能直接删除"))
            } else {
                ("", None, None, None)
            };
        let last = if managed == "系统文件" && kind.is_some() { "—".to_string() } else { ago(f.mtime.max(f.atime.min(crate::store::now_ms()))) };
        BigFile {
            id, name, dir: display(f.path.parent().unwrap_or(&f.path)), gb, ftype: ftype(&f.path).into(), last,
            managed: managed.into(), act, kind: kind.map(Into::into), why: why.map(Into::into),
        }
    }).collect();
    (rows, ids)
}

/// Folders whose files are never offered as duplicates (apps and the system own them).
fn dup_excluded(p: &Path, r: &Roots) -> bool {
    let s = p.to_string_lossy().to_lowercase();
    is_within(p, &r.windows) || is_within(p, &r.drive.join("Program Files")) || is_within(p, &r.drive.join("Program Files (x86)"))
        || is_within(p, &r.program_data) || is_within(p, &r.user.join("AppData")) || is_within(p, &r.drive.join("$Recycle.Bin"))
        || s.contains("\\node_modules\\") || s.contains("\\.git\\") || s.contains("\\.ollama\\") || s.contains("\\huggingface\\")
        || s.contains("\\site-packages\\") || s.contains("\\miniconda3\\") || s.contains("\\anaconda3\\")
}

fn edge_hash(p: &Path, size: u64) -> Option<[u8; 32]> {
    let mut f = File::open(p).ok()?;
    let mut h = blake3::Hasher::new();
    h.update(&size.to_le_bytes());
    let mut buf = vec![0u8; EDGE as usize];
    let n = f.read(&mut buf).ok()?;
    h.update(&buf[..n]);
    if size > EDGE * 2 {
        f.seek(SeekFrom::End(-(EDGE as i64))).ok()?;
        let n = f.read(&mut buf).ok()?;
        h.update(&buf[..n]);
    }
    Some(*h.finalize().as_bytes())
}

pub fn full_hash(p: &Path) -> Option<[u8; 32]> {
    let mut f = File::open(p).ok()?;
    let mut h = blake3::Hasher::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).ok()?;
        if n == 0 { break; }
        h.update(&buf[..n]);
    }
    Some(*h.finalize().as_bytes())
}

/// Files that are byte-for-byte identical. Returns groups (most wasted space first) and id → paths.
pub fn duplicates(files: &[FileRec], roots: &Roots) -> (Vec<DupGroup>, HashMap<String, Vec<PathBuf>>) {
    let mut by_size: HashMap<u64, Vec<&FileRec>> = HashMap::new();
    for f in files.iter().filter(|f| f.size >= DUP_MIN && !dup_excluded(&f.path, roots)) {
        by_size.entry(f.size).or_default().push(f);
    }
    // stage 2: first/last 64 KiB
    let cands: Vec<&FileRec> = by_size.values().filter(|v| v.len() > 1).flatten().copied().collect();
    let edged: Vec<(&FileRec, [u8; 32])> = cands.par_iter().filter_map(|f| edge_hash(&f.path, f.size).map(|h| (*f, h))).collect();
    let mut by_edge: HashMap<[u8; 32], Vec<&FileRec>> = HashMap::new();
    for (f, h) in edged { by_edge.entry(h).or_default().push(f); }
    // stage 3: whole file
    let cands: Vec<&FileRec> = by_edge.values().filter(|v| v.len() > 1).flatten().copied().collect();
    let full: Vec<(&FileRec, [u8; 32])> = cands.par_iter().filter_map(|f| full_hash(&f.path).map(|h| (*f, h))).collect();
    let mut by_full: HashMap<[u8; 32], Vec<&FileRec>> = HashMap::new();
    for (f, h) in full { by_full.entry(h).or_default().push(f); }

    let mut groups: Vec<Vec<&FileRec>> = by_full.into_values().filter(|v| v.len() > 1).collect();
    groups.sort_by(|a, b| (b[0].size * (b.len() as u64 - 1)).cmp(&(a[0].size * (a.len() as u64 - 1))));
    let mut ids = HashMap::new();
    let out = groups.into_iter().enumerate().map(|(i, mut g)| {
        g.sort_by_key(|f| f.mtime);
        let id = format!("g{i}");
        ids.insert(id.clone(), g.iter().map(|f| f.path.clone()).collect());
        DupGroup {
            id,
            name: g[0].path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            each: g[0].size as f64 / GB,
            copies: g.iter().map(|f| DupCopy { dir: display(f.path.parent().unwrap_or(&f.path)), date: ymd(f.mtime) }).collect(),
        }
    }).collect();
    (out, ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{sandbox, scan};
    use std::sync::atomic::AtomicBool;

    #[test]
    fn finds_large_files_and_true_duplicates_only() {
        let dir = crate::testutil::tmp();
        let root = dir.path().join("sb");
        sandbox::generate(&root).unwrap();
        let roots = Roots::for_sandbox(&root);
        let res = scan::scan(&root, &roots, &[], &AtomicBool::new(false), |_| {}).unwrap();

        let (big, ids) = large(&res.files, &roots);
        let names: Vec<&str> = big.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(names[0], "ubuntu-24.04-desktop-amd64.iso");
        assert!(names.contains(&"docker_data.vhdx") && names.contains(&"pagefile.sys"));
        assert!(!names.contains(&"sha256-6a0746a1ec1a"), "400 MB is below the 1 GB line");
        assert_eq!(big.iter().find(|b| b.name == "docker_data.vhdx").unwrap().kind.as_deref(), Some("map"));
        assert_eq!(big.iter().find(|b| b.name == "pagefile.sys").unwrap().managed, "系统文件");
        assert_eq!(ids.len(), big.len());

        let (groups, gids) = duplicates(&res.files, &roots);
        let gname: Vec<(&str, usize)> = groups.iter().map(|g| (g.name.as_str(), g.copies.len())).collect();
        assert!(gname.contains(&("毕业答辩录像.mov", 2)));
        assert!(gname.contains(&("论文插图_v3.zip", 3)));
        assert!(gname.contains(&("S2B_MSIL2A_20230805_T50QKM.zip", 2)));
        assert!(!groups.iter().any(|g| g.name.starts_with("实验记录")), "same size, different content");
        assert!(!groups.iter().any(|g| g.name.ends_with(".whl")), "AppData caches are not offered");
        assert_eq!(groups[0].name, "毕业答辩录像.mov", "most wasted space first");
        assert_eq!(gids.len(), groups.len());
    }
}
