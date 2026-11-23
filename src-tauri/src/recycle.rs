//! Recycle Bin operations. Nothing here deletes permanently, except `empty_bin`, which the UI only
//! calls after an explicit "不可恢复" confirmation and which is refused in a sandbox.
//!
//! Before handing a path to the Shell we check that this volume's Recycle Bin will actually keep it:
//! Windows destroys items that are larger than the bin's maximum size (or every item when the bin
//! is set to "delete immediately"), and a silent API call would not ask first. Such items are
//! refused and reported instead.

use crate::guard;
use crate::model::Skipped;
use crate::sandbox::Roots;
use std::path::{Path, PathBuf};

pub struct Outcome {
    /// (path, bytes) that are now in the Recycle Bin
    pub recycled: Vec<(PathBuf, u64)>,
    pub skipped: Vec<Skipped>,
}

fn name_of(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p.display().to_string())
}

/// Bytes a path occupies (files under a folder, links not followed).
pub fn size_on_disk(p: &Path) -> u64 {
    let Ok(md) = std::fs::symlink_metadata(p) else { return 0 };
    if md.is_file() {
        return md.len();
    }
    if !md.is_dir() {
        return 0;
    }
    jwalk::WalkDir::new(p).follow_links(false).skip_hidden(false).into_iter().flatten()
        .filter(|e| e.file_type.is_file()).filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum()
}

/// (max bytes the bin keeps per item, bin set to delete immediately) for the volume holding `p`.
pub fn bin_limits(p: &Path) -> (u64, bool) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Storage::FileSystem::{GetVolumeNameForVolumeMountPointW, GetVolumePathNameW};
        let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
        let pw = wide(&p.to_string_lossy());
        let mut mount = vec![0u16; 512];
        let mut guid = vec![0u16; 128];
        let total = crate::drives::raw_drives().into_iter()
            .find(|d| p.to_string_lossy().to_uppercase().starts_with(&format!("{}:", d.0)))
            .map(|d| d.2 * crate::drives::GB).unwrap_or(0.0) as u64;
        // Windows' default for a new volume: 5 % of its size
        let default = (total / 20).max(1);
        unsafe {
            if GetVolumePathNameW(pw.as_ptr(), mount.as_mut_ptr(), mount.len() as u32) == 0 { return (default, false); }
            if GetVolumeNameForVolumeMountPointW(mount.as_ptr(), guid.as_mut_ptr(), guid.len() as u32) == 0 { return (default, false); }
        }
        let g = String::from_utf16_lossy(&guid[..guid.iter().position(|&c| c == 0).unwrap_or(0)]);
        let Some(braced) = g.find('{').map(|i| g[i..].trim_end_matches('\\').to_string()) else { return (default, false) };
        let hk = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
        let key = hk.open_subkey(format!("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\BitBucket\\Volume\\{braced}"));
        match key {
            Ok(k) => {
                let max_mb: u32 = k.get_value("MaxCapacity").unwrap_or(0);
                let nuke: u32 = k.get_value("NukeOnDelete").unwrap_or(0);
                (if max_mb > 0 { max_mb as u64 * 1024 * 1024 } else { default }, nuke != 0)
            }
            Err(_) => (default, false),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = p;
        (u64::MAX, false)
    }
}

/// Move paths to the Recycle Bin, each one guarded and capacity-checked. Never deletes permanently.
pub fn recycle(paths: &[PathBuf], target: &Roots, app_data: &Path) -> Outcome {
    let mut out = Outcome { recycled: Vec::new(), skipped: Vec::new() };
    for p in paths {
        if !p.exists() && std::fs::symlink_metadata(p).is_err() {
            continue;
        }
        if let Err(b) = guard::check_write(p, target, app_data) {
            out.skipped.push(Skipped { name: name_of(p), reason: b.0 });
            continue;
        }
        let size = size_on_disk(p);
        let (max, nuke) = bin_limits(p);
        if nuke {
            out.skipped.push(Skipped { name: name_of(p), reason: "这块磁盘的回收站设成了「不移入回收站，直接删除」，为防止找不回，没有处理".into() });
            continue;
        }
        if size > max {
            out.skipped.push(Skipped { name: name_of(p), reason: format!("有 {:.1} GB，超过回收站上限 {:.1} GB，Windows 会直接永久删除，所以没有处理", size as f64 / 1073741824.0, max as f64 / 1073741824.0) });
            continue;
        }
        match trash::delete(p) {
            Ok(()) if !p.exists() => out.recycled.push((p.clone(), size)),
            Ok(()) => out.skipped.push(Skipped { name: name_of(p), reason: "有文件正在使用，没有移入回收站".into() }),
            Err(e) => out.skipped.push(Skipped { name: name_of(p), reason: friendly(&e.to_string()) }),
        }
    }
    out
}

/// Recycle each child of `dir` separately (for %TEMP%: in-use files are skipped, the folder stays).
pub fn recycle_contents(dir: &Path, target: &Roots, app_data: &Path) -> Outcome {
    let kids: Vec<PathBuf> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).collect();
    let mut o = recycle(&kids, target, app_data);
    let in_use = o.skipped.iter().filter(|s| s.reason.contains("正在使用") || s.reason.contains("另一个程序")).count();
    if in_use > 0 {
        o.skipped.retain(|s| !(s.reason.contains("正在使用") || s.reason.contains("另一个程序")));
        log::info!("{in_use} item(s) in {} are in use and were skipped", dir.display());
    }
    o
}

fn friendly(e: &str) -> String {
    let l = e.to_lowercase();
    if l.contains("being used") || l.contains("another process") || l.contains("0x80070020") {
        "有文件正在使用，没有移入回收站".into()
    } else if l.contains("access") || l.contains("0x80070005") {
        "没有权限移动它".into()
    } else {
        format!("没有移入回收站：{e}")
    }
}

/// Put recycled items back where they were. Returns paths that could not be restored.
pub fn restore(paths: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    let items = trash::os_limited::list().map_err(|e| format!("读不了回收站：{e}"))?;
    let want: Vec<String> = paths.iter().map(|p| p.to_string_lossy().to_lowercase()).collect();
    // newest deletion first, one item per original path
    let mut picked = Vec::new();
    let mut found = vec![false; want.len()];
    let mut sorted: Vec<_> = items.into_iter().collect();
    sorted.sort_by_key(|it| std::cmp::Reverse(it.time_deleted));
    for it in sorted {
        let orig = it.original_path().to_string_lossy().to_lowercase();
        if let Some(i) = want.iter().position(|w| *w == orig)
            && !found[i] {
                found[i] = true;
                picked.push(it);
            }
    }
    let mut missing: Vec<PathBuf> = paths.iter().zip(&found).filter(|(_, f)| !**f).map(|(p, _)| p.clone()).collect();
    if !picked.is_empty()
        && let Err(e) = trash::os_limited::restore_all(picked) {
            return Err(match e {
                trash::Error::RestoreCollision { path, .. } => format!("{} 已经有同名文件，没有覆盖", path.display()),
                other => format!("没能从回收站恢复：{other}"),
            });
        }
    missing.retain(|p| !p.exists());
    Ok(missing)
}

/// Empty this drive's Recycle Bin (irreversible). Refused for a sandbox target.
pub fn empty_bin(target: &Roots) -> Result<(), String> {
    if target.sandbox {
        return Err("沙盒模式下不会清空真实的回收站".into());
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::{SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND};
        let w: Vec<u16> = target.drive.to_string_lossy().encode_utf16().chain(std::iter::once(0)).collect();
        let hr = unsafe { SHEmptyRecycleBinW(std::ptr::null_mut(), w.as_ptr(), SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND) };
        if hr != 0 && hr as u32 != 0x8000FFFF {
            return Err(format!("没能清空回收站（{hr:#x}）"));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("只支持 Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox;

    #[test]
    fn recycle_then_restore_in_the_sandbox() {
        let dir = crate::testutil::tmp();
        let root = dir.path().join("sb");
        sandbox::generate(&root).unwrap();
        let r = Roots::for_sandbox(&root);
        let app = dir.path().join("appdata");
        let pip = r.local.join("pip").join("Cache");
        let zoom = r.user.join("Downloads").join("Zoom_6.2.4.exe");
        let sys32 = r.windows.join("System32");

        let o = recycle(&[pip.clone(), zoom.clone(), sys32.clone()], &r, &app);
        assert_eq!(o.recycled.len(), 2, "skipped: {:?}", o.skipped.iter().map(|s| &s.reason).collect::<Vec<_>>());
        assert!(!pip.exists() && !zoom.exists());
        assert!(sys32.exists(), "protected path untouched");
        assert_eq!(o.skipped.len(), 1);
        assert_eq!(o.recycled.iter().find(|x| x.0 == pip).unwrap().1, 6 * 60 * 1024 * 1024);

        let missing = restore(&[pip.clone(), zoom.clone()]).unwrap();
        assert!(missing.is_empty(), "{missing:?}");
        assert!(pip.join("http").join("w0.whl").exists() && zoom.exists());
        assert_eq!(std::fs::metadata(pip.join("http").join("w0.whl")).unwrap().len(), 60 * 1024 * 1024);
    }

    #[test]
    fn contents_keep_the_folder_and_bin_is_never_emptied_in_a_sandbox() {
        let dir = crate::testutil::tmp();
        let root = dir.path().join("sb");
        sandbox::generate(&root).unwrap();
        let r = Roots::for_sandbox(&root);
        let o = recycle_contents(&r.temp, &r, &dir.path().join("appdata"));
        assert_eq!(o.recycled.len(), 5);
        assert!(r.temp.exists() && std::fs::read_dir(&r.temp).unwrap().next().is_none());
        restore(&o.recycled.iter().map(|x| x.0.clone()).collect::<Vec<_>>()).unwrap();
        assert!(empty_bin(&r).is_err());
    }
}
