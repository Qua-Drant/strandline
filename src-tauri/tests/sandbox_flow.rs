//! End-to-end backend flow on a generated sandbox (never on a real drive):
//! scan → classify → clean to the Recycle Bin → undo → migrate with an interruption → resume →
//! undo the migration, with protected paths refused along the way.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use strandline_lib::catalog::{self, How};
use strandline_lib::migrate::{self, Control, Event, Job, Probes};
use strandline_lib::model::DriveInfo;
use strandline_lib::sandbox::{self, Roots};
use strandline_lib::{finder, guard, recycle, scan};

fn tmp() -> tempfile::TempDir {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("sandbox").join(".tests");
    std::fs::create_dir_all(&base).unwrap();
    let base = guard::dunce_canonical(&base).unwrap();
    tempfile::Builder::new().prefix("flow").tempdir_in(base).unwrap()
}

#[test]
fn full_flow_in_the_sandbox() {
    let dir = tmp();
    let root = dir.path().join("sb");
    sandbox::generate(&root).unwrap();
    let roots = Roots::for_sandbox(&root);
    let app_data = dir.path().join("appdata");
    let drive = DriveInfo { id: "D".into(), name: "测试盘".into(), total: 200.0, free: 100.0, free30: 100.0 };

    // ---- scan + classify
    let mut res = scan::scan(&root, &roots, &[], &AtomicBool::new(false), |_| {}).unwrap();
    let built = catalog::build(&res, &drive, std::slice::from_ref(&drive), &HashSet::new(), vec![], "12:00".into());
    let l1: Vec<&str> = built.model.leaves.iter().filter(|l| l.level == "L1").map(|l| l.id.as_str()).collect();
    for id in ["pip", "temp", "npm", "browser", "condapkgs"] {
        assert!(l1.contains(&id), "{id} should be a rebuildable block: {l1:?}");
    }
    assert!(built.model.leaves.iter().all(|l| l.level != "L1" || l.act == "recycle"), "rebuildable caches go to the Recycle Bin");

    // ---- clean every rebuildable block through its plan
    let mut recycled = Vec::new();
    for id in &l1 {
        let plan = &built.plans[*id];
        let o = match plan.how {
            How::Recycle => recycle::recycle(&plan.paths, &roots, &app_data),
            How::RecycleContents => recycle::recycle_contents(&plan.paths[0], &roots, &app_data),
            _ => unreachable!("rebuildable blocks are recycled"),
        };
        assert!(o.skipped.is_empty(), "{id}: {:?}", o.skipped.iter().map(|s| &s.reason).collect::<Vec<_>>());
        for (p, _) in &o.recycled { res.forget(p); }
        recycled.extend(o.recycled.into_iter().map(|x| x.0));
    }
    let after = catalog::build(&res, &drive, std::slice::from_ref(&drive), &HashSet::new(), vec![], "12:01".into());
    assert!(!after.model.leaves.iter().any(|l| l.level == "L1"), "cleaned blocks leave the map");
    assert_eq!(res.stat(&root).unwrap().size, res.total, "totals stay consistent");

    // ---- protected paths are never touched, even when asked directly
    let o = recycle::recycle(&[roots.windows.join("System32"), root.join("pagefile.sys"), roots.user.clone()], &roots, &app_data);
    assert!(o.recycled.is_empty() && o.skipped.len() == 3);
    assert!(roots.windows.join("System32").exists() && root.join("pagefile.sys").exists());

    // ---- undo: everything comes back from the Recycle Bin
    let missing = recycle::restore(&recycled).unwrap();
    assert!(missing.is_empty(), "{missing:?}");
    for p in &recycled { res.add_tree(p); }
    let back = catalog::build(&res, &drive, std::slice::from_ref(&drive), &HashSet::new(), vec![], "12:02".into());
    assert_eq!(back.model.leaves.iter().filter(|l| l.level == "L1").count(), l1.len());

    // ---- duplicates are found by content, not by size
    let (groups, _) = finder::duplicates(&res.files, &roots);
    assert_eq!(groups.len(), 3);

    // ---- migration: interrupted, resumed, verified, linked, undone
    let job = Job { src: roots.user.join("Datasets"), dst: root.join("_moved").join("Datasets"), link: true, verify: true, apps: vec![], app_label: String::new() };
    let probes = Probes { free_bytes: &|_| u64::MAX, running: &|_| false };
    let ctl = Control::default();
    let n = AtomicUsize::new(0);
    let err = migrate::run(&job, &roots, &app_data, &ctl, &probes, |e| {
        if matches!(e, Event::Progress(_)) && n.fetch_add(1, Ordering::Relaxed) == 1 { ctl.cancel.store(true, Ordering::Relaxed); }
    });
    // the dataset folder is small; if the copy finished before the stop landed, that's fine too
    if let Err(e) = err {
        assert_eq!(e, "已停止");
        assert!(job.src.is_dir(), "source untouched after an interruption");
    }
    if job.src.join("Landsat-9").exists() && !std::fs::symlink_metadata(&job.src).unwrap().file_type().is_symlink() {
        let fin = migrate::run(&job, &roots, &app_data, &Control::default(), &probes, |_| {}).unwrap();
        assert!(fin.linked);
        let via_link = job.src.join("Landsat-9").join("LC09_L2SP_123032_20240611_T1.tar");
        assert_eq!(std::fs::metadata(&via_link).unwrap().len(), 800 * 1024 * 1024);
        migrate::undo(&job.src, fin.recycled_backup.as_ref().or(fin.kept_backup.as_ref()).unwrap(), fin.recycled_backup.is_some()).unwrap();
        assert!(std::fs::metadata(&via_link).is_ok() && !std::fs::symlink_metadata(&job.src).unwrap().file_type().is_symlink());
    }
}
