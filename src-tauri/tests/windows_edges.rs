//! Real-Windows edge cases, reproduced inside a generated sandbox (never on a real drive):
//! junction loops, junctions to other folders, hard links, cloud placeholders, unreadable folders.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use strandline_lib::migrate::{self, Job, Probes};
use strandline_lib::model::Rule;
use strandline_lib::sandbox::{self, Roots};
use strandline_lib::{finder, guard, rules, scan, winfs};

fn tmp() -> tempfile::TempDir {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("sandbox").join(".tests");
    std::fs::create_dir_all(&base).unwrap();
    let base = guard::dunce_canonical(&base).unwrap();
    tempfile::Builder::new().prefix("edge").tempdir_in(base).unwrap()
}

fn setup() -> (tempfile::TempDir, PathBuf, Roots) {
    let d = tmp();
    let root = d.path().join("sb");
    sandbox::generate(&root).unwrap();
    let r = Roots::for_sandbox(&root);
    (d, root, r)
}

fn full(root: &Path, r: &Roots) -> scan::ScanResult {
    scan::scan(root, r, &[], &AtomicBool::new(false), |_| {}).unwrap()
}

#[test]
fn junctions_are_not_followed_and_hard_links_count_once() {
    let (_d, root, r) = setup();
    let before = full(&root, &r);
    // a loop (points at an ancestor), like C:\Documents and Settings → C:\Users
    junction::create(&r.user, r.user.join("Documents").join("loop")).unwrap();
    // a second path to a big folder
    junction::create(r.user.join("Datasets"), root.join("datasets-again")).unwrap();
    // hard links: a big file in Downloads, and a small system file the way WinSxS links into System32
    std::fs::hard_link(r.user.join("Downloads").join("Zoom_6.2.4.exe"), r.user.join("Desktop").join("zoom-link.exe")).unwrap();
    std::fs::create_dir_all(r.windows.join("System32").join("en-US")).unwrap();
    std::fs::write(r.windows.join("WinSxS").join("small.mui"), vec![7u8; 10_000]).unwrap();
    std::fs::hard_link(r.windows.join("WinSxS").join("small.mui"), r.windows.join("System32").join("en-US").join("small.mui")).unwrap();

    let after = full(&root, &r);
    assert_eq!(after.total, before.total + 10_000, "only the new 10 KB file adds bytes");
    assert_eq!(after.nfiles, before.nfiles + 1);
    assert_eq!(after.hardlinks, 2, "two extra links detected");
    assert!(after.stat(&r.user.join("Documents").join("loop")).is_none(), "junction not entered");
    assert!(after.stat(&root.join("datasets-again")).is_none());
    assert_eq!(after.files.iter().filter(|f| f.path.file_name().unwrap() == "Zoom_6.2.4.exe" || f.path.file_name().unwrap() == "zoom-link.exe").count(), 1);
    // the hard link is not offered as a duplicate of itself
    let (groups, _) = finder::duplicates(&after.files, &r);
    assert!(!groups.iter().any(|g| g.name.to_lowercase().contains("zoom")));
}

#[test]
fn cloud_placeholders_are_never_counted_read_moved_or_recycled() {
    let (_d, root, r) = setup();
    let od = r.user.join("OneDrive").join("Photos");
    std::fs::create_dir_all(&od).unwrap();
    // two identical "online-only" files: identical content, so only the cloud rule keeps them out of dupes
    for n in ["a.jpg", "b.jpg"] {
        std::fs::write(od.join(n), vec![42u8; 3 << 20]).unwrap();
        winfs::set_offline(&od.join(n)).unwrap();
        assert!(winfs::is_cloud(&od.join(n)));
    }
    // and one in Downloads, where a rule would look
    std::fs::write(r.user.join("Downloads").join("old-setup.exe"), vec![1u8; 2 << 20]).unwrap();
    let old = std::time::SystemTime::now() - std::time::Duration::from_secs(90 * 86_400);
    std::fs::File::options().write(true).open(r.user.join("Downloads").join("old-setup.exe")).unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(old)).unwrap();
    winfs::set_offline(&r.user.join("Downloads").join("old-setup.exe")).unwrap();

    let res = full(&root, &r);
    assert_eq!(res.cloud_files, 3);
    assert_eq!(res.cloud_bytes, (3 << 20) * 2 + (2 << 20));
    assert_eq!(res.stat(&od).map(|d| d.size).unwrap_or(0), 0, "placeholders add no bytes");
    assert!(!res.files.iter().any(|f| f.path.starts_with(&od)), "not in the file index");
    let (groups, _) = finder::duplicates(&res.files, &r);
    assert!(!groups.iter().any(|g| g.name.ends_with(".jpg")));
    assert!(finder::full_hash(&od.join("a.jpg")).is_none(), "never hashed (would download)");

    // a rule over Downloads skips it
    let rule = Rule { id: "x".into(), name: "x".into(), on: true, sched: "day".into(), lv: "L2".into(), action: "移入回收站 · 可撤销".into(),
        when: vec![("位置".into(), "下载".into()), ("类型".into(), ".exe".into()), ("早于".into(), "30 天".into())], last: String::new(), files: vec![], last_run: 0 };
    let m = rules::matches(&rules::parse(&rule, &r).unwrap());
    assert!(!m.iter().any(|(p, _)| p.ends_with("old-setup.exe")));

    // migrating a folder that holds online-only files is refused before anything is copied
    let job = Job { src: od.clone(), dst: root.join("_moved").join("Photos"), link: true, verify: false, apps: vec![], app_label: String::new() };
    // (the OneDrive root itself is refused by the guard as a user root folder)
    let e = migrate::preflight(&job, &r, &root.join("appdata"), &Probes { free_bytes: &|_| u64::MAX, running: &|_| false }).unwrap_err();
    assert!(e.contains("云端"), "{e}");
    assert!(!root.join("_moved").exists());
}

fn icacls(args: &[&str]) {
    let st = Command::new("icacls").args(args).output().unwrap();
    assert!(st.status.success(), "icacls {args:?}: {}", String::from_utf8_lossy(&st.stdout));
}

#[test]
fn unreadable_folders_are_skipped_and_counted() {
    let (_d, root, r) = setup();
    let locked = r.user.join("Documents").join("private");
    std::fs::create_dir_all(&locked).unwrap();
    std::fs::write(locked.join("secret.bin"), vec![0u8; 5 << 20]).unwrap();
    let user = std::env::var("USERNAME").unwrap();
    // deny listing to ourselves (only on this throwaway sandbox folder)
    icacls(&[locked.to_str().unwrap(), "/deny", &format!("{user}:(RD)")]);
    let res = full(&root, &r);
    icacls(&[locked.to_str().unwrap(), "/remove:d", &user]);
    assert!(res.skipped >= 1, "the unreadable folder is counted");
    assert!(res.total > 20 << 30, "the rest of the sandbox was still scanned");
    assert!(!res.files.iter().any(|f| f.path.starts_with(&locked)));
}
