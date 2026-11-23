//! Large-tree performance check (ignored by default — it writes ~300 000 files into the sandbox):
//!   cargo test --release --test perf -- --ignored --nocapture
//! Reports scan time, peak memory and the size of everything the UI receives.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::time::Instant;
use strandline_lib::model::DriveInfo;
use strandline_lib::sandbox::{self, Roots};
use strandline_lib::{catalog, finder, guard, scan};

fn peak_mb() -> f64 {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
        use windows_sys::Win32::System::Threading::GetCurrentProcess;
        let mut c: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
        c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        GetProcessMemoryInfo(GetCurrentProcess(), &mut c, c.cb);
        return c.PeakWorkingSetSize as f64 / 1048576.0;
    }
    #[allow(unreachable_code)]
    0.0
}

#[test]
#[ignore]
fn three_hundred_thousand_files() {
    const DIRS: usize = 3_000;
    const PER_DIR: usize = 100;
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("sandbox").join(".tests");
    std::fs::create_dir_all(&base).unwrap();
    let base = guard::dunce_canonical(&base).unwrap();
    // a persistent tree (sandbox/.perf-tree) so re-runs only pay for the scan, not for 300 000 file writes
    let root = base.join("..").join(".perf-tree");
    let root = { std::fs::create_dir_all(&root).unwrap(); guard::dunce_canonical(&root).unwrap() };
    let done = root.join(".generated");
    if !done.exists() {
        sandbox::generate(&root).unwrap();
    }
    let r = Roots::for_sandbox(&root);
    if !done.exists() {
        let t = Instant::now();
        let proj = r.user.join("Projects").join("monorepo");
        for i in 0..DIRS {
            let dir = proj.join(format!("pkg{:04}", i / 100)).join(format!("mod{i:04}"));
            std::fs::create_dir_all(&dir).unwrap();
            for j in 0..PER_DIR {
                // small files of varied size; every 50th is 1.5 MiB so the file index and duplicate finder get work
                let len = if j % 50 == 0 { 3 << 19 } else { (i * 7 + j * 13) % 4096 };
                std::fs::write(dir.join(format!("f{j:03}.dat")), vec![(i % 251) as u8; len]).unwrap();
            }
        }
        std::fs::write(&done, "").unwrap();
        println!("generated {} files in {:.1}s", DIRS * PER_DIR, t.elapsed().as_secs_f64());
    }

    let t = Instant::now();
    let res = scan::scan(&root, &r, &[], &AtomicBool::new(false), |_| {}).unwrap();
    let scan_s = t.elapsed().as_secs_f64();
    let drive = DriveInfo { id: "D".into(), name: "测试盘".into(), total: 900.0, free: 300.0, free30: 300.0 };
    let t = Instant::now();
    let built = catalog::build(&res, &drive, std::slice::from_ref(&drive), &HashSet::new(), vec![300.0; 29], "12:00".into());
    let build_ms = t.elapsed().as_millis();
    let (large, _) = finder::large(&res.files, &r);
    let t = Instant::now();
    let (dupes, _) = finder::duplicates(&res.files, &r);
    let dupe_s = t.elapsed().as_secs_f64();

    let model = serde_json::to_vec(&built.model).unwrap().len();
    let rows = serde_json::to_vec(&built.rows).unwrap().len();
    let large_b = serde_json::to_vec(&large).unwrap().len();
    let dupes_b = serde_json::to_vec(&dupes).unwrap().len();
    println!("scanned {} files, {} folders in {scan_s:.1}s ({:.0} files/s)", res.nfiles, res.dirs.len(), res.nfiles as f64 / scan_s);
    println!("file index (>= 1 MiB): {} entries; catalog build {build_ms} ms; duplicates {dupe_s:.1}s ({} groups)", res.files.len(), dupes.len());
    println!("to the UI: map model {model} B ({} blocks), suggestions {rows} B, large files {large_b} B, duplicates {dupes_b} B", built.model.leaves.len());
    println!("peak working set: {:.0} MB", peak_mb());

    assert!(res.nfiles >= (DIRS * PER_DIR) as u64);
    assert!(built.model.leaves.len() < 60, "the map stays aggregated");
    assert!(model < 64 * 1024, "map model stays small: {model} B");
    assert!(dupes.len() <= finder::MAX_GROUPS && large.len() <= finder::MAX_LARGE);
    assert!(dupes_b < 512 * 1024, "duplicate list is capped: {dupes_b} B");
}

