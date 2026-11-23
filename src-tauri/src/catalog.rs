//! Turns a scan into what the UI shows: space-map blocks (leaves) grouped by category, cleaning
//! suggestions, and migration plans. Known locations are recognised from local metadata only
//! (paths, names, sizes and times) — file contents are never read here.

use crate::model::{Cat, CleanRow, DriveInfo, Leaf, MapModel, Move};
use crate::paths::{display, head_tail, is_within};
use crate::sandbox::Roots;
use crate::scan::ScanResult;
use crate::timefmt::{ago, days_since};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

pub const GB: f64 = 1024.0 * 1024.0 * 1024.0;
const OLD_BUILD_DAYS: u32 = 90;
const OLD_INSTALLER_DAYS: u32 = 30;

/// How cleaning an item is carried out.
#[derive(Debug, Clone, PartialEq)]
pub enum How {
    /// move each path to the Recycle Bin
    Recycle,
    /// move each child of the folder to the Recycle Bin, keeping the folder (e.g. %TEMP%)
    RecycleContents,
    /// empty the Recycle Bin of this drive (irreversible; needs explicit confirmation in the UI)
    EmptyBin,
    /// cannot be done by Strandline itself; the reason is shown and the command can be copied
    Manual(String),
    Keep,
}

#[derive(Debug, Clone)]
pub struct Plan {
    pub paths: Vec<PathBuf>,
    pub how: How,
    pub name: String,
    pub level: String,
}

pub struct Built {
    pub model: MapModel,
    pub rows: Vec<CleanRow>,
    pub plans: HashMap<String, Plan>,
    pub foam: Vec<String>,
}

struct Spec {
    id: &'static str,
    cat: &'static str,
    name: String,
    short: String,
    xs: String,
    level: &'static str,
    act: &'static str,
    paths: Vec<PathBuf>,
    how: How,
    note: &'static str,
    cmd: String,
    meta: bool,
    mv: &'static str,
    /// a cache the overview's one-tap clean may take
    foam: bool,
}

const CATS: &[(&str, &str, &str, &str)] = &[
    ("sys", "系统与应用", "系统与应用", "其他"),
    ("dev", "开发环境", "开发环境", "其他"),
    ("user", "个人数据", "个人数据", "其他"),
    ("wx", "微信文件", "微信文件", "其他"),
    ("ai", "本地 AI 模型", "AI 模型", "其他"),
    ("dl", "下载", "下载", "其他"),
    ("tmp", "临时文件与缓存", "临时与缓存", "其他缓存"),
    ("docs", "文稿与照片", "文稿与照片", "其他"),
    ("junk", "系统与回收站", "系统与回收站", "其他"),
    ("other", "其他", "其他", "其他"),
];

#[allow(clippy::too_many_arguments)] // a table row: every field is needed
fn spec(id: &'static str, cat: &'static str, name: &str, short: &str, level: &'static str, act: &'static str, paths: Vec<PathBuf>, how: How, note: &'static str) -> Spec {
    Spec { id, cat, name: name.into(), short: short.into(), xs: String::new(), level, act, paths, how, note, cmd: String::new(), meta: false, mv: "", foam: false }
}

impl Spec {
    fn cmd(mut self, c: &str) -> Self { self.cmd = c.into(); self }
    fn meta(mut self) -> Self { self.meta = true; self }
    fn mv(mut self, m: &'static str) -> Self { self.mv = m; self }
    fn foam(mut self) -> Self { self.foam = true; self }
}

fn exists_any(paths: &[PathBuf]) -> Vec<PathBuf> {
    paths.iter().filter(|p| p.exists()).cloned().collect()
}

fn specs(r: &Roots, scan: &ScanResult) -> Vec<Spec> {
    let u = &r.user;
    let mut v = vec![
        // ---- system & apps (kept)
        spec("win", "sys", "Windows 系统", "Windows", "L4", "keep", vec![r.windows.clone()], How::Keep, "系统文件，交给 Windows 自己管理。"),
        spec("prog", "sys", "已安装的应用", "应用", "L4", "keep", vec![r.drive.join("Program Files"), r.drive.join("Program Files (x86)")], How::Keep, "要删应用请用「设置 › 应用」卸载。"),
        spec("progdata", "sys", "程序数据", "ProgramData", "L4", "keep", vec![r.program_data.clone()], How::Keep, "各应用共用的数据和设置。"),
        spec("pagefile", "sys", "页面文件", "页面文件", "L4", "keep", vec![r.drive.join("pagefile.sys"), r.drive.join("swapfile.sys")], How::Keep, "虚拟内存，由系统自动管理。"),
        spec("hiber", "sys", "休眠文件", "休眠文件", "L2", "setting", vec![r.drive.join("hiberfil.sys")], How::Manual("关闭休眠需要管理员权限：请在管理员终端运行 powercfg /h off，随时可以用 powercfg /h on 还原".into()), "关掉休眠会同时关掉快速启动，开机会慢几秒；随时可以还原。").cmd("powercfg /h off").meta(),
        // ---- development
        spec("docker", "dev", "Docker WSL 磁盘", "Docker 磁盘", "L4", "keep", vec![r.local.join("Docker").join("wsl")], How::Keep, "虚拟磁盘只涨不缩。先在 Docker 里清理不用的镜像再压缩，或整体迁移到其他盘。").cmd("docker system prune\nwsl --shutdown\nOptimize-VHD -Path \"$env:LOCALAPPDATA\\Docker\\wsl\\disk\\docker_data.vhdx\" -Mode Full").meta().mv("m_docker"),
        spec("wsl", "dev", "WSL Ubuntu", "Ubuntu", "L4", "keep", vec![r.local.join("Packages").join("CanonicalGroupLimited.Ubuntu").join("LocalState")], How::Keep, "里面有你的 Linux 主目录。").mv("m_wsl"),
        spec("condapkgs", "dev", "conda 包缓存", "conda 缓存", "L1", "recycle", exists_any(&[u.join("miniconda3").join("pkgs"), u.join("anaconda3").join("pkgs")]), How::Recycle, "装完包留下的压缩包，需要时会重新下载。").cmd("conda clean --all -y").foam(),
        spec("condaenv", "dev", "conda 环境", "conda 环境", "L4", "keep", exists_any(&[u.join("miniconda3").join("envs"), u.join("anaconda3").join("envs")]), How::Keep, "正在使用的 Python 环境。"),
        spec("cargo", "dev", "Cargo 下载缓存", "Cargo 缓存", "L1", "recycle", vec![u.join(".cargo").join("registry").join("cache")], How::Recycle, "Rust 依赖的下载缓存，需要时会重新下载。").cmd("cargo cache --autoclean").foam(),
        spec("gradle", "dev", "Gradle 缓存", "Gradle", "L1", "recycle", vec![u.join(".gradle").join("caches")], How::Recycle, "Gradle 依赖缓存，构建时会重新下载。").foam(),
        // ---- AI models
        spec("ollama", "ai", "Ollama 模型", "Ollama", "L4", "keep", vec![u.join(".ollama").join("models")], How::Keep, "本地模型，用 ollama rm 删除不用的模型，或整体迁移到其他盘。").cmd("ollama list\nollama rm <模型名>").mv("m_ollama"),
        spec("hf", "ai", "Hugging Face 模型缓存", "HF 缓存", "L2", "recycle", vec![u.join(".cache").join("huggingface").join("hub")], How::Recycle, "下载过的模型权重，可以从 Hugging Face 重新下载；正在用的模型下次加载会重新下载。").meta(),
        // ---- WeChat
        spec("wx", "wx", "微信文件", "微信文件", "L4", "keep", exists_any(&[u.join("Documents").join("WeChat Files"), u.join("Documents").join("xwechat_files")]), How::Keep, "聊天记录的原件，删了找不回；适合整体迁移到其他盘。").mv("m_wx"),
        // ---- caches (rebuildable)
        spec("pip", "tmp", "pip 缓存", "pip", "L1", "recycle", vec![r.local.join("pip").join("Cache")], How::Recycle, "下载过的安装包缓存，需要时会重新下载。").cmd("pip cache purge").foam(),
        spec("temp", "tmp", "临时文件", "临时", "L1", "recycle", vec![r.temp.clone()], How::RecycleContents, "程序运行时留下的临时文件，正在用的会自动跳过。").foam(),
        spec("browser", "tmp", "浏览器缓存", "浏览器", "L1", "recycle", browser_caches(r), How::Recycle, "Edge 与 Chrome 的网页缓存，不含密码和书签；浏览器开着时部分文件会被跳过。").foam(),
        spec("npm", "tmp", "npm 缓存", "npm", "L1", "recycle", vec![r.local.join("npm-cache")], How::Recycle, "下载过的 npm 包，需要时会重新下载。").cmd("npm cache clean --force").foam(),
        spec("yarn", "tmp", "Yarn 缓存", "Yarn", "L1", "recycle", vec![r.local.join("Yarn").join("Cache")], How::Recycle, "Yarn 下载缓存，需要时会重新下载。").foam(),
        spec("crash", "tmp", "程序崩溃转储", "崩溃转储", "L1", "recycle", vec![r.local.join("CrashDumps")], How::Recycle, "程序崩溃时留下的诊断文件，一般用不到。").foam(),
        spec("nvidia", "tmp", "NVIDIA 安装缓存", "NVIDIA", "L1", "recycle", vec![r.program_data.join("NVIDIA Corporation").join("Downloader")], How::Recycle, "驱动安装完成后留下的安装包。").foam(),
        // ---- Windows-managed leftovers: shown, but cleaned by Windows' own tools
        spec("winupd", "junk", "Windows 更新残留", "更新残留", "L4", "keep", vec![r.windows.join("SoftwareDistribution").join("Download")], How::Keep, "Windows 更新下载的安装包，由「设置 › 系统 › 存储 › 临时文件」清理。").cmd("cleanmgr /sageset:1"),
        spec("delivery", "junk", "传递优化文件", "传递优化", "L4", "keep", vec![r.windows.join("SoftwareDistribution").join("DeliveryOptimization")], How::Keep, "Windows 更新时的分发缓存，由 Windows 自己清理。").cmd("Delete-DeliveryOptimizationCache -Force"),
        spec("recycle", "junk", "回收站", "回收站", "L3", "empty", vec![r.drive.join("$Recycle.Bin")], How::EmptyBin, "已经删掉、还没清空的文件。清空后无法找回。").cmd("Clear-RecycleBin"),
        // ---- user folders (kept; large ones can be migrated)
        spec("docs", "docs", "文稿", "文稿", "L4", "keep", vec![u.join("Documents")], How::Keep, "").mv("g_docs"),
        spec("pics", "docs", "图片", "图片", "L4", "keep", vec![u.join("Pictures")], How::Keep, "").mv("g_pics"),
        spec("videos", "docs", "视频", "视频", "L4", "keep", vec![u.join("Videos")], How::Keep, "").mv("g_videos"),
        spec("desktop", "docs", "桌面", "桌面", "L4", "keep", vec![u.join("Desktop")], How::Keep, ""),
        spec("appdata", "other", "应用数据", "AppData", "L4", "keep", vec![u.join("AppData")], How::Keep, "各应用自己的设置与数据。"),
        spec("dlother", "dl", "其他下载", "下载", "L4", "keep", vec![u.join("Downloads")], How::Keep, "").mv("g_dl"),
    ];

    // installers left in Downloads for a month
    let dl = u.join("Downloads");
    let installers: Vec<PathBuf> = std::fs::read_dir(&dl).into_iter().flatten().flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter(|e| { let n = e.file_name().to_string_lossy().to_lowercase(); n.ends_with(".exe") || n.ends_with(".msi") || n.ends_with(".msix") })
        .filter(|e| e.metadata().ok().and_then(|m| m.modified().ok()).map(|t| days_since(t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)) >= OLD_INSTALLER_DAYS).unwrap_or(false))
        .map(|e| e.path()).collect();
    let n = installers.len();
    let mut s = spec("installers", "dl", &format!("放了一个月以上的安装包 ×{n}"), &format!("安装包 ×{n}"), "L2", "recycle", installers, How::Recycle, "下载文件夹里 30 天前的 .exe / .msi。放进回收站，需要时还能找回。").meta();
    s.xs = "安装包".into();
    v.push(s);

    // build products of projects untouched for 90 days
    let builds: Vec<PathBuf> = scan.node_modules.iter().chain(scan.cargo_targets.iter())
        .filter(|p| p.parent().map(|proj| days_since(scan.newest_of(proj)) >= OLD_BUILD_DAYS).unwrap_or(false))
        .cloned().collect();
    let n = builds.len();
    let mut s = spec("builds", "dev", &format!("旧项目构建产物 ×{n}"), "构建产物", "L2", "recycle", builds, How::Recycle, "90 天没改动的项目里的 node_modules 和 Rust target，npm install / cargo build 可以重建。").meta();
    s.xs = format!("旧依赖 ×{n}");
    v.push(s);

    // top-level folders of the profile that nothing above covers (Datasets, Projects, Zotero…)
    let known: HashSet<&str> = ["appdata", "documents", "downloads", "pictures", "videos", "desktop", "music", ".cache", ".ollama", "miniconda3", "anaconda3", ".cargo", ".gradle", "onedrive"].into_iter().collect();
    let mut extra: Vec<(PathBuf, u64)> = std::fs::read_dir(u).into_iter().flatten().flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|e| !known.contains(e.file_name().to_string_lossy().to_lowercase().as_str()))
        .map(|e| { let p = e.path(); let sz = scan.size_of(&p); (p, sz) })
        .filter(|(_, sz)| *sz as f64 / GB >= 0.2)
        .collect();
    extra.sort_by_key(|e| std::cmp::Reverse(e.1));
    const IDS: [&str; 4] = ["user1", "user2", "user3", "user4"];
    const MVS: [&str; 4] = ["g_user1", "g_user2", "g_user3", "g_user4"];
    for (i, (p, _)) in extra.into_iter().take(4).enumerate() {
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        v.push(spec(IDS[i], "user", &name, &name, "L4", "keep", vec![p], How::Keep, "你自己的文件夹，适合整体迁移到其他盘。").mv(MVS[i]));
    }
    v
}

fn browser_caches(r: &Roots) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for base in [r.local.join("Microsoft").join("Edge").join("User Data"), r.local.join("Google").join("Chrome").join("User Data")] {
        let profiles = std::fs::read_dir(&base).into_iter().flatten().flatten()
            .filter(|e| { let n = e.file_name().to_string_lossy().to_string(); n == "Default" || n.starts_with("Profile ") });
        for p in profiles {
            for c in ["Cache", "Code Cache", "GPUCache"] {
                let d = p.path().join(c);
                if d.exists() { out.push(d); }
            }
        }
    }
    out
}

/// Recycle Bin size for a real drive (Shell API); None in a sandbox or on failure.
pub fn recycle_bin_bytes(drive_root: &Path) -> Option<u64> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
        let wide: Vec<u16> = drive_root.as_os_str().to_string_lossy().encode_utf16().chain(std::iter::once(0)).collect();
        let mut info: SHQUERYRBINFO = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<SHQUERYRBINFO>() as u32;
        let hr = unsafe { SHQueryRecycleBinW(wide.as_ptr(), &mut info) };
        if hr == 0 { return Some(info.i64Size.max(0) as u64); }
        None
    }
    #[cfg(not(windows))]
    {
        let _ = drive_root;
        None
    }
}

fn mins_label(gb: f64) -> String {
    let m = (gb * 1024.0 / 120.0 / 60.0).ceil().max(1.0); // ~120 MB/s copy + verify
    if m < 60.0 { format!("约 {m} 分钟") } else { format!("约 {:.1} 小时", m / 60.0) }
}

/// Best other fixed drive to move things to (most free space), or None.
pub fn best_target(drives: &[DriveInfo], source: &str) -> Option<String> {
    drives.iter().filter(|d| d.id != source && d.name != "移动硬盘").max_by(|a, b| a.free.total_cmp(&b.free)).map(|d| d.id.clone())
}

fn move_plan(id: &str, name: &str, cells: Vec<String>, src: &Path, to: String, gb: f64) -> Move {
    let (app, how): (Option<&str>, &str) = match id {
        "m_wx" => (Some("微信"), "复制并校验后，在原处留目录联接，微信照常打开"),
        "m_docker" => (Some("Docker Desktop"), "复制并校验后，在原处留目录联接；也可以用 Docker 自带的 Disk image location"),
        "m_wsl" => (Some("WSL"), "复制并校验后，在原处留目录联接；需要先 wsl --shutdown"),
        "m_ollama" => (Some("Ollama"), "复制并校验后，在原处留目录联接，模型路径不用改"),
        _ => (None, "复制并校验后，在原处留目录联接，原路径照常可用"),
    };
    let mut steps = Vec::new();
    if let Some(a) = app {
        steps.push(format!("确认 {a} 没有运行（正在运行会自动暂停，退出后点重试）"));
    }
    steps.push("检查 {to} 所在磁盘的剩余空间".to_string());
    steps.push("分块复制到 {to}，逐个文件核对大小与 BLAKE3 校验和".to_string());
    steps.push("把原文件夹改名备份，在原处建立指向 {to} 的目录联接".to_string());
    steps.push("确认能从原路径读到文件后，把备份移入回收站".to_string());
    Move {
        id: id.into(), name: name.into(), cells, frm: display(src), to, how: how.into(), mins: mins_label(gb), link: true,
        verify: "完成后再从新位置读回全部文件，重新核对校验和".into(), steps, generic: app.is_none(),
    }
}

/// Build the map model and suggestions from a scan.
/// `drive` is the drive that holds the scan root; `drives` all drives (for migration targets);
/// `cleaned` ids already cleaned this session.
pub fn build(scan: &ScanResult, drive: &DriveInfo, drives: &[DriveInfo], cleaned: &HashSet<String>, history30: Vec<f64>, scanned_at: String) -> Built {
    let r = &scan.roots;
    let specs = specs(r, scan);
    let raw: Vec<u64> = specs.iter().map(|s| s.paths.iter().map(|p| scan.size_of(p)).sum()).collect();

    // a container (e.g. Downloads) shows only what its nested blocks (e.g. installers) don't
    let within = |a: &Spec, b: &Spec| !a.paths.is_empty() && !b.paths.is_empty() && a.paths.iter().all(|pa| b.paths.iter().any(|pb| is_within(pa, pb) && !is_within(pb, pa)));
    let own: Vec<u64> = (0..specs.len()).map(|i| {
        let nested: u64 = (0..specs.len())
            .filter(|&j| j != i && within(&specs[j], &specs[i]))
            .filter(|&j| !(0..specs.len()).any(|k| k != i && k != j && within(&specs[j], &specs[k]) && within(&specs[k], &specs[i])))
            .map(|j| raw[j]).sum();
        raw[i].saturating_sub(nested)
    }).collect();

    let mut leaves: Vec<Leaf> = Vec::new();
    let mut plans = HashMap::new();
    let mut rows = Vec::new();
    let mut foam = Vec::new();
    let mut bin_gb = 0.0;
    let real_bin = if r.sandbox { None } else { recycle_bin_bytes(&r.drive) };
    let sum_own: u64 = own.iter().sum();
    let n = specs.len() as f64 + 2.0;

    for (i, s) in specs.iter().enumerate() {
        let mut gb = own[i] as f64 / GB;
        if s.id == "recycle" {
            if let Some(b) = real_bin { gb = b as f64 / GB; }
            bin_gb = gb;
        }
        if gb < 0.001 || s.paths.is_empty() {
            continue;
        }
        let first = &s.paths[0];
        let (head, tail) = if s.paths.len() == 1 { head_tail(first) } else {
            let p = first.parent().unwrap_or(first);
            (display(p) + "\\", format!("{} 处", s.paths.len()))
        };
        let is_clean = cleaned.contains(s.id);
        let newest = s.paths.iter().map(|p| scan.newest_of(p)).max().unwrap_or(0);
        leaves.push(Leaf {
            id: s.id.into(), cat: s.cat.into(), cat_name: CATS.iter().find(|c| c.0 == s.cat).map(|c| c.1).unwrap_or("").into(),
            name: s.name.clone(), short: s.short.clone(), xs: s.xs.clone(), gb, gain: gb, level: s.level.into(), act: s.act.into(),
            path_head: head.clone(), path_tail: tail.clone(), note: s.note.into(), cmd: s.cmd.clone(), meta: s.meta, move_id: s.mv.into(),
            rv: (i as f64 + 1.0) / n * 100.0, actual: gb, cleaned: is_clean,
        });
        plans.insert(s.id.to_string(), Plan { paths: s.paths.clone(), how: s.how.clone(), name: s.name.clone(), level: s.level.into() });
        if ["L1", "L2", "L3"].contains(&s.level) {
            rows.push(CleanRow {
                id: s.id.into(), name: s.name.clone(), level: s.level.into(), act: s.act.into(), gain: gb, head, tail, note: s.note.into(),
                cmd: s.cmd.clone(), meta: s.meta, last: if s.id == "recycle" || s.id == "hiber" { "—".into() } else { ago(newest) },
                days: if s.id == "recycle" || s.id == "hiber" { 999 } else { days_since(newest) }, done: is_clean,
            });
            if s.foam && !is_clean { foam.push(s.id.to_string()); }
        }
    }

    // whatever no block covers, and (on a real drive) what the scan could not read
    let rest = scan.total.saturating_sub(sum_own) as f64 / GB;
    if rest >= 0.001 {
        leaves.push(Leaf { id: "rest".into(), cat: "other".into(), cat_name: "其他".into(), name: "其他文件".into(), short: "其他".into(), xs: String::new(), gb: rest, gain: rest, level: "L4".into(), act: "keep".into(), path_head: display(&r.drive), path_tail: String::new(), note: "没有归到上面任何一类的文件。".into(), cmd: String::new(), meta: false, move_id: String::new(), rv: 99.0, actual: rest, cleaned: false });
    }
    if !r.sandbox {
        let used = drive.total - drive.free;
        let unreadable = used - scan.total as f64 / GB - (bin_gb - own[specs.iter().position(|s| s.id == "recycle").unwrap_or(0)] as f64 / GB).max(0.0);
        if unreadable >= 0.05 {
            leaves.push(Leaf { id: "sysrest".into(), cat: "sys".into(), cat_name: "系统与应用".into(), name: "系统保留与无法读取的部分".into(), short: "系统保留".into(), xs: String::new(), gb: unreadable, gain: unreadable, level: "L4".into(), act: "keep".into(), path_head: display(&r.drive), path_tail: String::new(), note: "文件系统元数据、卷影副本，以及没有权限读取的文件夹。".into(), cmd: String::new(), meta: false, move_id: String::new(), rv: 98.0, actual: unreadable, cleaned: false });
        }
    }

    // categories in a fixed order, only those with blocks
    let cats: Vec<Cat> = CATS.iter().filter_map(|(id, name, short, cl)| {
        let items: Vec<String> = leaves.iter().filter(|l| l.cat == *id).map(|l| l.id.clone()).collect();
        if items.is_empty() { None } else { Some(Cat { id: (*id).into(), name: (*name).into(), short: (*short).into(), items, cl: (*cl).into() }) }
    }).collect();

    // migration plans for blocks that can move to another drive
    let target = best_target(drives, &drive.id);
    let mut moves = Vec::new();
    let mut seen = HashSet::new();
    for l in &leaves {
        if l.move_id.is_empty() || l.gb < 0.05 || !seen.insert(l.move_id.clone()) {
            continue;
        }
        let cells: Vec<String> = leaves.iter().filter(|x| x.move_id == l.move_id).map(|x| x.id.clone()).collect();
        let gb: f64 = leaves.iter().filter(|x| x.move_id == l.move_id).map(|x| x.gb).sum();
        let src = plans.get(&l.id).and_then(|p: &Plan| p.paths.first().cloned()).unwrap_or_default();
        let folder = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| l.name.clone());
        let to = if r.sandbox {
            display(&r.drive.join("_moved").join(&folder))
        } else {
            target.as_ref().map(|t| format!("{t}:\\{folder}")).unwrap_or_default()
        };
        moves.push(move_plan(&l.move_id, &l.name, cells, &src, to, gb));
    }

    let model = MapModel { drive: drive.clone(), leaves, cats, moves, bin: bin_gb, history30, scanned_at };
    Built { model, rows, plans, foam }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{sandbox, scan};
    use std::sync::atomic::AtomicBool;

    #[test]
    fn classifies_the_sandbox() {
        let dir = crate::testutil::tmp();
        let root = dir.path().join("sb");
        sandbox::generate(&root).unwrap();
        let roots = Roots::for_sandbox(&root);
        let res = scan::scan(&root, &roots, &[], &AtomicBool::new(false), |_| {}).unwrap();
        let d = DriveInfo { id: "D".into(), name: "数据盘".into(), total: 100.0, free: 50.0, free30: 50.0 };
        let b = build(&res, &d, std::slice::from_ref(&d), &HashSet::new(), vec![], "12:00".into());
        let leaf = |id: &str| b.model.leaves.iter().find(|l| l.id == id).unwrap_or_else(|| panic!("leaf {id}"));
        let mb = |x: f64| (x * 1024.0).round();
        assert_eq!(mb(leaf("pip").gb), 360.0);
        assert_eq!(leaf("pip").level, "L1");
        assert_eq!(leaf("installers").name, "放了一个月以上的安装包 ×3", "cuda (180 d), Zoom (60 d), Git (45 d)");
        assert_eq!(leaf("builds").name, "旧项目构建产物 ×2");
        assert!(leaf("win").level == "L4" && leaf("recycle").level == "L3");
        // containers don't double count: total of all blocks = everything scanned
        let sum: f64 = b.model.leaves.iter().map(|l| l.gb).sum();
        assert!((sum - res.total as f64 / GB).abs() < 0.001, "sum {sum} vs scanned {}", res.total as f64 / GB);
        // Downloads remainder excludes installers
        assert!(leaf("dlother").gb > 6.0 - 0.1 && leaf("dlother").gb < 6.1, "iso 6 GB + pdf + dup zip");
        // migration plans stay inside the sandbox
        let m = b.model.moves.iter().find(|m| m.id == "m_ollama").expect("ollama move");
        assert!(m.to.contains("_moved"), "{}", m.to);
        assert!(b.foam.contains(&"pip".to_string()) && b.foam.contains(&"temp".to_string()));
        assert!(b.rows.iter().all(|r| r.level != "L4"));
        assert!(b.model.cats.iter().any(|c| c.id == "user" && c.items.iter().any(|i| i.starts_with("user"))), "Datasets / Projects");
    }
}
