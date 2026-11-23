//! Write guard. Every path the app is about to recycle, move or link passes `check_write` first.
//! The deny list is hard-coded on purpose: no setting, rule or UI can widen it.

use crate::paths::is_within;
use crate::sandbox::Roots;
use std::path::{Path, PathBuf};

/// File names that are never touched, wherever they are (paging, hibernation, boot, registry hives).
const DENY_NAMES: &[&str] = &[
    "pagefile.sys", "hiberfil.sys", "swapfile.sys", "bootmgr", "bootnxt", "bootsect.bak",
    "ntuser.dat", "ntuser.dat.log1", "ntuser.dat.log2", "ntuser.ini", "usrclass.dat", "usrclass.dat.log1", "usrclass.dat.log2",
    "desktop.ini",
];

/// Directories (relative to the drive root) whose whole subtree is off limits.
const DENY_DRIVE_DIRS: &[&str] = &[
    "Windows", "Program Files", "Program Files (x86)", "ProgramData\\Microsoft", "ProgramData\\Packages",
    "System Volume Information", "$Recycle.Bin", "Recovery", "Boot", "EFI", "$WinREAgent", "$SysReset",
    "$Windows.~BT", "$Windows.~WS", "Config.Msi", "Documents and Settings", "PerfLogs", "OneDriveTemp",
];

/// Directories under the user profile that are off limits (registry hive store, start menu, credentials…).
const DENY_USER_DIRS: &[&str] = &[
    "AppData\\Local\\Microsoft\\Windows", "AppData\\Roaming\\Microsoft", "AppData\\Local\\Packages\\Microsoft.Windows",
    "AppData\\Local\\Microsoft\\Credentials", "AppData\\Local\\Microsoft\\Vault",
];

#[derive(Debug, Clone, PartialEq)]
pub struct Blocked(pub String);

impl std::fmt::Display for Blocked {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Folders that may hold things we touch, but must never be recycled or moved themselves.
fn anchors(r: &Roots) -> Vec<PathBuf> {
    let mut v = vec![r.drive.clone(), r.drive.join("Users"), r.user.clone(), r.user.join("AppData"), r.local.clone(), r.roaming.clone(), r.temp.clone(), r.program_data.clone()];
    for k in ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music", "OneDrive"] {
        v.push(r.user.join(k));
    }
    v
}

fn check_against(p: &Path, r: &Roots) -> Result<(), Blocked> {
    for a in anchors(r) {
        if same(p, &a) {
            return Err(Blocked(format!("{} 是系统或用户的根文件夹，只能处理它里面的内容", a.display())));
        }
    }
    for d in DENY_DRIVE_DIRS {
        let root = r.drive.join(d);
        if is_within(p, &root) {
            return Err(Blocked(format!("{} 属于受保护的系统目录", root.display())));
        }
    }
    if is_within(p, &r.windows) {
        return Err(Blocked(format!("{} 属于 Windows 系统目录", r.windows.display())));
    }
    for d in DENY_USER_DIRS {
        let root = r.user.join(d);
        if is_within(p, &root) {
            return Err(Blocked(format!("{} 由 Windows 管理", root.display())));
        }
    }
    Ok(())
}

fn same(a: &Path, b: &Path) -> bool {
    is_within(a, b) && is_within(b, a)
}

/// May the app recycle / move / replace `p`?
///
/// * `p` must be absolute and must not climb out with `..`.
/// * Checked against the real system roots always, and also against the sandbox roots when the
///   current target is a sandbox — in which case `p` must also lie inside the sandbox.
/// * Checked both as given and after resolving links, so a junction cannot smuggle a system folder in.
/// * The app's own data folder is never touched.
pub fn check_write(p: &Path, target: &Roots, app_data: &Path) -> Result<(), Blocked> {
    if !p.is_absolute() {
        return Err(Blocked(format!("{} 不是完整路径", p.display())));
    }
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(Blocked(format!("{} 含有 ..，拒绝处理", p.display())));
    }
    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
        let n = name.to_ascii_lowercase();
        if DENY_NAMES.contains(&n.as_str()) || n.starts_with("dumpstack.log") {
            return Err(Blocked(format!("{name} 是系统文件，不能删除或移动")));
        }
    }
    let real = Roots::real(&system_letter());
    let resolved = dunce_canonical(p);
    for q in std::iter::once(p.to_path_buf()).chain(resolved.clone()) {
        check_against(&q, &real)?;
        if is_within(&q, app_data) {
            return Err(Blocked("这是 Strandline 自己的数据文件夹".into()));
        }
        if target.sandbox {
            if !is_within(&q, &target.drive) {
                return Err(Blocked(format!("沙盒模式下只能处理 {} 里面的文件", target.drive.display())));
            }
            check_against(&q, target)?;
        }
    }
    Ok(())
}

fn system_letter() -> String {
    crate::drives::system_drive()
}

/// Canonical path without the `\\?\` prefix (None when the path does not exist).
pub fn dunce_canonical(p: &Path) -> Option<PathBuf> {
    let c = std::fs::canonicalize(p).ok()?;
    let s = c.to_string_lossy();
    Some(match s.strip_prefix("\\\\?\\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => c,
    })
}

/// Read-only scans skip these too (no value in listing them, and some are slow or locked).
pub fn skip_when_scanning(p: &Path, r: &Roots) -> bool {
    ["System Volume Information", "$WinREAgent", "$SysReset", "Config.Msi"].iter().any(|d| is_within(p, &r.drive.join(d)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app() -> PathBuf {
        PathBuf::from("C:\\Users\\x\\AppData\\Roaming\\Strandline")
    }

    #[test]
    fn blocks_system_paths_on_the_real_drive() {
        let r = Roots::real("C");
        let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        for p in [
            sysroot.clone(),
            format!("{sysroot}\\System32\\drivers"),
            "C:\\Program Files\\App".into(),
            "C:\\Program Files (x86)".into(),
            "C:\\pagefile.sys".into(),
            "C:\\".into(),
            "C:\\Users".into(),
            "C:\\System Volume Information\\x".into(),
            "C:\\$Recycle.Bin\\S-1\\x".into(),
        ] {
            assert!(check_write(Path::new(&p), &r, &app()).is_err(), "should block {p}");
        }
        let up = std::env::var("USERPROFILE").unwrap();
        assert!(check_write(Path::new(&up), &r, &app()).is_err(), "profile root");
        assert!(check_write(Path::new(&format!("{up}\\Downloads")), &r, &app()).is_err(), "Downloads root itself");
        assert!(check_write(Path::new(&format!("{up}\\NTUSER.DAT")), &r, &app()).is_err(), "registry hive");
        assert!(check_write(Path::new(&format!("{up}\\AppData\\Local\\Microsoft\\Windows\\UsrClass.dat")), &r, &app()).is_err());
        assert!(check_write(Path::new("relative\\path"), &r, &app()).is_err());
        assert!(check_write(Path::new(&format!("{up}\\Downloads\\..\\..\\Windows")), &r, &app()).is_err());
        // ordinary user content is allowed
        assert!(check_write(Path::new(&format!("{up}\\Downloads\\setup.exe")), &r, &app()).is_ok());
        assert!(check_write(Path::new(&format!("{up}\\AppData\\Local\\pip\\Cache")), &r, &app()).is_ok());
    }

    #[test]
    fn sandbox_confines_writes() {
        let dir = crate::testutil::tmp();
        let root = dir.path().join("sb");
        crate::sandbox::generate(&root).unwrap();
        let r = Roots::for_sandbox(&root);
        let ok = r.local.join("pip").join("Cache");
        assert!(check_write(&ok, &r, &app()).is_ok());
        assert!(check_write(&r.windows.join("System32"), &r, &app()).is_err(), "sandbox Windows");
        assert!(check_write(&root.join("Program Files").join("App"), &r, &app()).is_err(), "sandbox Program Files");
        assert!(check_write(&root.join("pagefile.sys"), &r, &app()).is_err());
        assert!(check_write(&r.user, &r, &app()).is_err(), "sandbox profile root");
        let up = std::env::var("USERPROFILE").unwrap();
        assert!(check_write(Path::new(&format!("{up}\\Downloads\\setup.exe")), &r, &app()).is_err(), "outside the sandbox");
    }
}
