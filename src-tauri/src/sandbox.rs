//! Sandbox generator: a fake Windows drive tree for development and tests, so scanning, cleaning,
//! undo and migration never have to touch a real C: drive.
//!
//! Layout under `<root>` mirrors a drive: `Users\demo\...`, `Windows\...`, `Program Files\...`,
//! `ProgramData\...`, `$Recycle.Bin`. A marker file `.strandline-sandbox` identifies it; the scanner
//! maps %USERPROFILE%, %LOCALAPPDATA% etc. into the sandbox when it sees the marker.
//!
//! Big files are created *sparse* on NTFS: they report their full size (so the large-file page and
//! the space map look realistic) but take almost no disk space.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

pub const MARKER: &str = ".strandline-sandbox";
pub const USER: &str = "demo";
const MB: u64 = 1024 * 1024;
const GB: u64 = 1024 * MB;

/// Fake environment roots inside a sandbox (or the real ones when not sandboxed).
#[derive(Debug, Clone)]
pub struct Roots {
    pub drive: PathBuf,
    pub user: PathBuf,
    pub local: PathBuf,
    pub roaming: PathBuf,
    pub temp: PathBuf,
    pub program_data: PathBuf,
    pub windows: PathBuf,
    pub sandbox: bool,
}

impl Roots {
    pub fn for_sandbox(root: &Path) -> Self {
        let user = root.join("Users").join(USER);
        Roots {
            drive: root.to_path_buf(),
            local: user.join("AppData").join("Local"),
            roaming: user.join("AppData").join("Roaming"),
            temp: user.join("AppData").join("Local").join("Temp"),
            program_data: root.join("ProgramData"),
            windows: root.join("Windows"),
            user,
            sandbox: true,
        }
    }

    pub fn real(drive_letter: &str) -> Self {
        let env = |k: &str, d: &str| std::env::var(k).map(PathBuf::from).unwrap_or_else(|_| PathBuf::from(d));
        Roots {
            drive: PathBuf::from(format!("{drive_letter}:\\")),
            user: env("USERPROFILE", "C:\\Users\\Default"),
            local: env("LOCALAPPDATA", "C:\\Users\\Default\\AppData\\Local"),
            roaming: env("APPDATA", "C:\\Users\\Default\\AppData\\Roaming"),
            temp: env("TEMP", "C:\\Windows\\Temp"),
            program_data: env("ProgramData", "C:\\ProgramData"),
            windows: env("SystemRoot", "C:\\Windows"),
            sandbox: false,
        }
    }

    /// Roots for a scan target: a sandbox folder (has the marker) or a whole drive.
    pub fn for_target(scan_root: &str, drive_letter: &str) -> Self {
        let r = Path::new(scan_root);
        if !scan_root.trim().is_empty() && r.join(MARKER).exists() { Roots::for_sandbox(r) } else { Roots::real(drive_letter) }
    }
}

pub fn is_sandbox(root: &Path) -> bool {
    root.join(MARKER).exists()
}

/// Write `len` bytes of `seed`-derived content (real data, for hashing/dup tests).
fn real_file(p: &Path, len: u64, seed: u8) -> std::io::Result<()> {
    if let Some(d) = p.parent() {
        fs::create_dir_all(d)?;
    }
    let mut f = File::create(p)?;
    let mut block = vec![0u8; 64 * 1024];
    for (i, b) in block.iter_mut().enumerate() {
        *b = (i as u8).wrapping_mul(31).wrapping_add(seed);
    }
    let mut left = len;
    while left > 0 {
        let n = left.min(block.len() as u64) as usize;
        f.write_all(&block[..n])?;
        left -= n as u64;
    }
    Ok(())
}

/// A file that reports `len` bytes but is sparse (NTFS) so it costs almost no space.
fn sparse_file(p: &Path, len: u64) -> std::io::Result<()> {
    if let Some(d) = p.parent() {
        fs::create_dir_all(d)?;
    }
    let mut f = File::create(p)?;
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::IO::DeviceIoControl;
        use windows_sys::Win32::System::Ioctl::FSCTL_SET_SPARSE;
        let mut ret = 0u32;
        let ok = unsafe { DeviceIoControl(f.as_raw_handle() as _, FSCTL_SET_SPARSE, std::ptr::null(), 0, std::ptr::null_mut(), 0, &mut ret, std::ptr::null_mut()) };
        if ok == 0 {
            // not NTFS (e.g. FAT test volume): fall back to a small real file so we never fill the disk
            drop(f);
            return real_file(p, len.min(8 * MB), 7);
        }
    }
    // a unique header so sparse files of the same size are not identical
    let mut head = p.to_string_lossy().as_bytes().to_vec();
    head.resize(4096, b'.');
    f.write_all(&head[..head.len().min(len as usize)])?;
    f.set_len(len)?;
    Ok(())
}

fn touch_old(p: &Path, days: u64) {
    if let Ok(f) = File::options().write(true).open(p) {
        let t = std::time::SystemTime::now() - std::time::Duration::from_secs(days * 86_400);
        let _ = f.set_times(fs::FileTimes::new().set_modified(t).set_accessed(t));
    }
}

/// Summary of what was generated.
#[derive(Debug, Default)]
pub struct Generated {
    pub files: usize,
    pub logical_bytes: u64,
}

/// Build the sandbox under `root` (created if missing). Refuses to write into a non-empty folder
/// that is not already a sandbox, so it can never scatter files into real data.
pub fn generate(root: &Path) -> std::io::Result<Generated> {
    if root.exists() && fs::read_dir(root)?.next().is_some() && !is_sandbox(root) {
        return Err(std::io::Error::other(format!("{} 不是空文件夹，也不是沙盒；为安全起见不写入", root.display())));
    }
    fs::create_dir_all(root)?;
    fs::write(root.join(MARKER), "Strandline sandbox — safe to delete. Generated test data only.\n")?;
    let r = Roots::for_sandbox(root);
    let mut g = Generated::default();
    let mut add = |p: PathBuf, len: u64, kind: char, seed: u8, age_days: u64| -> std::io::Result<()> {
        match kind {
            's' => sparse_file(&p, len)?,
            _ => real_file(&p, len, seed)?,
        }
        if age_days > 0 {
            touch_old(&p, age_days);
        }
        g.files += 1;
        g.logical_bytes += len;
        Ok(())
    };

    // ---- system (protected: guard must refuse to touch these)
    add(r.windows.join("System32").join("kernel32.dll"), 2 * MB, 'r', 1, 400)?;
    add(r.windows.join("WinSxS").join("amd64_component").join("payload.dll"), 3 * MB, 'r', 2, 300)?;
    add(r.drive.join("Program Files").join("App").join("app.exe"), 4 * MB, 'r', 3, 200)?;
    add(r.drive.join("pagefile.sys"), 4 * GB, 's', 0, 0)?;
    add(r.drive.join("hiberfil.sys"), 3 * GB, 's', 0, 0)?;
    add(r.drive.join("$Recycle.Bin").join("S-1-5-21-demo").join("$RDEMO.bin"), 220 * MB, 's', 4, 20)?;

    // ---- caches (rebuildable)
    for i in 0..6 { add(r.local.join("pip").join("Cache").join("http").join(format!("w{i}.whl")), 60 * MB, 's', 10 + i, 20)?; }
    for i in 0..5 { add(r.temp.join(format!("tmp{i:03}.tmp")), 40 * MB, 's', 20 + i, 3)?; }
    for i in 0..4 { add(r.local.join("npm-cache").join("_cacache").join(format!("c{i}")), 50 * MB, 's', 30 + i, 15)?; }
    for i in 0..4 {
        add(r.local.join("Microsoft").join("Edge").join("User Data").join("Default").join("Cache").join("Cache_Data").join(format!("f_{i:06}")), 45 * MB, 's', 40 + i, 1)?;
    }
    add(r.user.join("miniconda3").join("pkgs").join("numpy-1.26.tar.bz2"), 300 * MB, 's', 50, 40)?;
    add(r.user.join("miniconda3").join("envs").join("geo").join("python.exe"), 420 * MB, 's', 51, 10)?;

    // ---- old build products
    add(r.user.join("Projects").join("old-site").join("node_modules").join("left-pad").join("index.js"), 250 * MB, 's', 60, 120)?;
    add(r.user.join("Projects").join("old-site").join("package.json"), 1024, 'r', 61, 120)?;
    add(r.user.join("Projects").join("rust-tool").join("target").join("debug").join("tool.exe"), 300 * MB, 's', 62, 100)?;
    add(r.user.join("Projects").join("rust-tool").join("Cargo.toml"), 512, 'r', 63, 100)?;

    // ---- apps that manage their own data (migrate, don't delete)
    add(r.local.join("Docker").join("wsl").join("disk").join("docker_data.vhdx"), 3 * GB / 2, 's', 0, 1)?;
    add(r.local.join("Packages").join("CanonicalGroupLimited.Ubuntu").join("LocalState").join("ext4.vhdx"), GB, 's', 0, 0)?;
    add(r.user.join(".ollama").join("models").join("blobs").join("sha256-6a0746a1ec1a"), 400 * MB, 's', 0, 3)?;
    add(r.user.join(".ollama").join("models").join("manifests").join("qwen2").join("latest"), 4096, 'r', 70, 3)?;
    add(r.user.join(".cache").join("huggingface").join("hub").join("models--Qwen--Qwen2-7B").join("model.safetensors"), 2 * GB, 's', 0, 210)?;
    add(r.user.join("Documents").join("WeChat Files").join("wxid_demo").join("FileStorage").join("MsgAttach").join("a.jpg"), 4 * MB, 'r', 80, 30)?;
    add(r.user.join("Documents").join("WeChat Files").join("wxid_demo").join("FileStorage").join("Video").join("v.mp4"), 300 * MB, 's', 81, 30)?;

    // ---- user files: large, installers, duplicates
    add(r.user.join("Downloads").join("ubuntu-24.04-desktop-amd64.iso"), 6 * GB, 's', 0, 150)?;
    add(r.user.join("Downloads").join("cuda_12.4.0_windows.exe"), 3 * GB, 's', 0, 180)?;
    add(r.user.join("Downloads").join("Zoom_6.2.4.exe"), 2 * MB, 'r', 90, 60)?;
    add(r.user.join("Downloads").join("Git-2.47.0-64-bit.exe"), 3 * MB, 'r', 91, 45)?;
    add(r.user.join("Downloads").join("2411.01234v2.pdf"), MB, 'r', 92, 5)?;
    add(r.user.join("Documents").join("答辩").join("毕业答辩录像.mov"), 8 * MB, 'r', 100, 240)?;
    add(r.user.join("Documents").join("WeChat Files").join("wxid_demo").join("FileStorage").join("File").join("2026-03").join("毕业答辩录像.mov"), 8 * MB, 'r', 100, 230)?;
    add(r.user.join("Documents").join("论文").join("论文插图_v3.zip"), 3 * MB, 'r', 101, 160)?;
    add(r.user.join("Desktop").join("论文插图_v3.zip"), 3 * MB, 'r', 101, 159)?;
    add(r.user.join("Downloads").join("论文插图_v3.zip"), 3 * MB, 'r', 101, 158)?;
    // same size, different content: must NOT be reported as duplicates
    add(r.user.join("Documents").join("实验").join("实验记录A.xlsx"), 2 * MB, 'r', 110, 30)?;
    add(r.user.join("Desktop").join("实验记录B.xlsx"), 2 * MB, 'r', 111, 30)?;
    add(r.user.join("Desktop").join("Screenshot 2026-11-20 101233.png"), 512 * 1024, 'r', 112, 2)?;
    add(r.user.join("Pictures").join("截图 2026-11-19 154410.png"), 512 * 1024, 'r', 113, 4)?;
    add(r.user.join("Datasets").join("Sentinel-2").join("S2B_MSIL2A_20230805_T50QKM.zip"), 5 * MB, 'r', 120, 50)?;
    add(r.user.join("Datasets").join("Landsat-9").join("LC09_L2SP_123032_20240611_T1.tar"), 800 * MB, 's', 121, 120)?;
    add(r.user.join("Downloads").join("S2B_MSIL2A_20230805_T50QKM.zip"), 5 * MB, 'r', 120, 51)?;

    Ok(g)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_and_refuses_foreign_folders() {
        let dir = crate::testutil::tmp();
        let root = dir.path().join("sb");
        let g = generate(&root).unwrap();
        assert!(g.files > 30);
        assert!(is_sandbox(&root));
        // big files report their logical size
        let iso = root.join("Users").join(USER).join("Downloads").join("ubuntu-24.04-desktop-amd64.iso");
        assert_eq!(fs::metadata(&iso).unwrap().len(), 6 * GB);
        // regenerating into an existing sandbox is fine
        generate(&root).unwrap();
        // a non-empty, non-sandbox folder is refused
        let other = dir.path().join("real");
        fs::create_dir_all(&other).unwrap();
        fs::write(other.join("keep.txt"), "x").unwrap();
        assert!(generate(&other).is_err());
    }
}
