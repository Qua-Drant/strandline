//! Write commands: Recycle-Bin cleaning with receipts and undo, verified migration, rules, and the
//! rule scheduler. Each action records an undo record and an activity entry.

use crate::catalog::How;
use crate::commands::{blocking, current, lock, target, CmdResult};
use crate::finder;
use crate::migrate::{self, Control, Event, Job, Probes};
use crate::model::*;
use crate::recycle;
use crate::rules;
use crate::sandbox::Roots;
use crate::store::{now_ms, UndoRecord};
use crate::AppState;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

const GB: f64 = 1024.0 * 1024.0 * 1024.0;

fn gb(b: u64) -> f64 { b as f64 / GB }
fn fmt_gb(g: f64) -> String { if g >= 1.0 { format!("{g:.1} GB") } else { format!("{:.0} MB", g * 1024.0) } }

/// Every write command starts here: in read-only mode nothing on disk is changed.
fn writable(state: &AppState) -> CmdResult<()> {
    if lock(&state.store).data.settings.read_only {
        return Err("只读模式：Strandline 现在只扫描，不移动、不删除任何文件。要清理或迁移，请在 设置 › 清理与安全 里关闭只读模式".into());
    }
    Ok(())
}

fn app_data(state: &AppState) -> PathBuf {
    lock(&state.store).dir().to_path_buf()
}

fn roots_for(state: &AppState, drive: &str) -> CmdResult<Roots> {
    Ok(target(state, drive)?.1)
}

/// Save the undo record, write the activity entry, return the receipt.
fn finish(state: &AppState, mut rc: Receipt, rec: UndoRecord, kind: &str, title: String, detail: String) -> Receipt {
    let mut st = lock(&state.store);
    rc.id = st.next_id("r");
    let undoable = rc.items.iter().any(|i| i.undoable);
    let total = rc.freed + rc.bin;
    if !rc.items.is_empty() {
        st.log(ActivityEvent {
            id: String::new(), day: String::new(), time: String::new(), kind: kind.into(), title, detail,
            amount: fmt_gb(total), undo: if undoable { "撤销".into() } else { String::new() },
            items: rc.items.iter().map(|i| (i.level.clone(), i.name.clone(), fmt_gb(i.gb))).collect(),
            undone: false, at: 0, receipt: Some(rc.id.clone()),
        });
    }
    st.data.undo.insert(rc.id.clone(), UndoRecord { receipt: rc.clone(), at: now_ms(), ..rec });
    st.save();
    rc
}

fn forget_in_scan(state: &AppState, paths: &[PathBuf]) {
    if let Some(sc) = lock(&state.scan).as_mut() {
        for p in paths { sc.result.forget(p); }
        sc.dupes = None;
    }
}

fn add_back_to_scan(state: &AppState, paths: &[PathBuf]) {
    if let Some(sc) = lock(&state.scan).as_mut() {
        for p in paths { sc.result.add_tree(p); }
        sc.dupes = None;
    }
}

// ---------------- cleaning

#[tauri::command]
pub async fn clean_items(app: AppHandle, drive: String, ids: Vec<String>) -> CmdResult<Receipt> {
    let a = app.clone();
    blocking(move || {
        let state = a.state::<AppState>();
        writable(&state)?;
        if !current(&state, &drive) { return Err("请先重新扫描".into()); }
        let roots = roots_for(&state, &drive)?;
        let app_dir = app_data(&state);
        let plans = lock(&state.scan).as_ref().map(|s| s.built.plans.clone()).unwrap_or_default();
        let mut rc = Receipt::default();
        let mut rec = UndoRecord::default();
        let mut gone = Vec::new();
        for id in ids {
            let Some(plan) = plans.get(&id) else { continue };
            let o = match &plan.how {
                How::Recycle => recycle::recycle(&plan.paths, &roots, &app_dir),
                How::RecycleContents => plan.paths.first().map(|d| recycle::recycle_contents(d, &roots, &app_dir)).unwrap_or(recycle::Outcome { recycled: vec![], skipped: vec![] }),
                How::EmptyBin => {
                    let before = crate::catalog::recycle_bin_bytes(&roots.drive).unwrap_or(0);
                    match recycle::empty_bin(&roots) {
                        Ok(()) => {
                            rc.freed += gb(before);
                            rc.items.push(ReceiptItem { id: id.clone(), name: plan.name.clone(), act: "empty".into(), level: plan.level.clone(), gb: gb(before), undoable: false });
                            if let Some(sc) = lock(&state.scan).as_mut() { sc.cleaned.insert(id.clone()); }
                        }
                        Err(e) => rc.skipped.push(Skipped { name: plan.name.clone(), reason: e }),
                    }
                    continue;
                }
                How::Manual(reason) => { rc.skipped.push(Skipped { name: plan.name.clone(), reason: reason.clone() }); continue; }
                How::Keep => continue,
            };
            let bytes: u64 = o.recycled.iter().map(|x| x.1).sum();
            if !o.recycled.is_empty() {
                rc.bin += gb(bytes);
                rc.items.push(ReceiptItem { id: id.clone(), name: plan.name.clone(), act: "recycle".into(), level: plan.level.clone(), gb: gb(bytes), undoable: true });
                rec.recycled.insert(id.clone(), o.recycled.iter().map(|x| x.0.to_string_lossy().to_string()).collect());
                rec.blocks.push(id.clone());
                gone.extend(o.recycled.iter().map(|x| x.0.clone()));
                if let Some(sc) = lock(&state.scan).as_mut() { sc.cleaned.insert(id.clone()); }
            }
            rc.skipped.extend(o.skipped);
        }
        forget_in_scan(&state, &gone);
        let n = rc.items.len();
        let detail = if rc.bin > 0.0 { format!("{} 移入回收站，30 天内可撤销", fmt_gb(rc.bin)) } else { "回收站已清空".into() };
        Ok(finish(&state, rc, rec, "clean", format!("清理 {n} 项"), detail))
    }).await
}

fn undo_paths(state: &AppState, rec: &UndoRecord, item: Option<&str>) -> CmdResult<()> {
    let mut paths: Vec<PathBuf> = Vec::new();
    for (id, ps) in &rec.recycled {
        if item.map(|i| i == id).unwrap_or(true) { paths.extend(ps.iter().map(PathBuf::from)); }
    }
    let missing = recycle::restore(&paths)?;
    let mut failed: Vec<String> = missing.iter().map(|p| p.display().to_string()).collect();
    for (id, mv) in &rec.moved {
        if item.map(|i| i == id).unwrap_or(true) { failed.extend(rules::undo_moves(mv)); }
    }
    if let Some((src, backup, from_bin)) = &rec.migration
        && item.is_none() {
            migrate::undo(Path::new(src), Path::new(backup), *from_bin)?;
        }
    add_back_to_scan(state, &paths);
    {
        if let Some(sc) = lock(&state.scan).as_mut() {
            for b in &rec.blocks { if item.map(|i| i == b).unwrap_or(true) { sc.cleaned.remove(b); } }
        }
    }
    if failed.is_empty() { Ok(()) } else { Err(format!("{} 项没能恢复（原位置已有同名文件或回收站里找不到）：{}", failed.len(), failed.join("、"))) }
}

#[tauri::command]
pub async fn undo_item(app: AppHandle, receipt_id: String, item_id: String) -> CmdResult<()> {
    let a = app.clone();
    blocking(move || {
        let state = a.state::<AppState>();
        let rec = lock(&state.store).data.undo.get(&receipt_id).cloned().ok_or("这条记录已经不能撤销")?;
        undo_paths(&state, &rec, Some(&item_id))?;
        let mut st = lock(&state.store);
        if let Some(r) = st.data.undo.get_mut(&receipt_id) {
            r.recycled.remove(&item_id);
            r.moved.remove(&item_id);
            if r.recycled.is_empty() && r.moved.is_empty() && r.migration.is_none() {
                for e in st.data.activity.iter_mut().filter(|e| e.receipt.as_deref() == Some(&receipt_id)) { e.undone = true; }
            }
        }
        st.save();
        Ok(())
    }).await
}

fn undo_whole(state: &AppState, receipt_id: &str) -> CmdResult<()> {
    let rec = lock(&state.store).data.undo.get(receipt_id).cloned().ok_or("这条记录已经不能撤销")?;
    undo_paths(state, &rec, None)?;
    let mut st = lock(&state.store);
    st.data.undo.remove(receipt_id);
    for e in st.data.activity.iter_mut().filter(|e| e.receipt.as_deref() == Some(receipt_id)) { e.undone = true; }
    st.save();
    Ok(())
}

#[tauri::command]
pub async fn undo_receipt(app: AppHandle, receipt_id: String) -> CmdResult<()> {
    let a = app.clone();
    blocking(move || undo_whole(&a.state::<AppState>(), &receipt_id)).await
}

#[tauri::command]
pub async fn undo_activity(app: AppHandle, id: String) -> CmdResult<()> {
    let a = app.clone();
    blocking(move || {
        let state = a.state::<AppState>();
        let receipt = lock(&state.store).data.activity.iter().find(|e| e.id == id).and_then(|e| e.receipt.clone()).ok_or("这条记录不能撤销")?;
        undo_whole(&state, &receipt)
    }).await
}

// ---------------- large files & duplicates

#[tauri::command]
pub async fn recycle_files(app: AppHandle, ids: Vec<String>) -> CmdResult<Receipt> {
    let a = app.clone();
    blocking(move || {
        let state = a.state::<AppState>();
        writable(&state)?;
        let (paths, roots) = {
            let g = lock(&state.scan);
            let sc = g.as_ref().ok_or("请先扫描")?;
            (ids.iter().filter_map(|i| sc.large_ids.get(i).map(|p| (i.clone(), p.clone()))).collect::<Vec<_>>(), sc.result.roots.clone())
        };
        let app_dir = app_data(&state);
        let mut rc = Receipt::default();
        let mut rec = UndoRecord::default();
        let mut gone = Vec::new();
        for (id, p) in paths {
            let o = recycle::recycle(std::slice::from_ref(&p), &roots, &app_dir);
            rc.skipped.extend(o.skipped);
            for (q, b) in o.recycled {
                rc.bin += gb(b);
                rc.items.push(ReceiptItem { id: id.clone(), name: q.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), act: "recycle".into(), level: "L2".into(), gb: gb(b), undoable: true });
                rec.recycled.insert(id.clone(), vec![q.to_string_lossy().to_string()]);
                gone.push(q);
            }
        }
        forget_in_scan(&state, &gone);
        let n = rc.items.len();
        Ok(finish(&state, rc, rec, "clean", format!("大文件 {n} 个移入回收站"), "30 天内可撤销".into()))
    }).await
}

#[tauri::command]
pub async fn recycle_duplicates(app: AppHandle, sel: Vec<DupSelection>) -> CmdResult<Receipt> {
    let a = app.clone();
    blocking(move || {
        let state = a.state::<AppState>();
        writable(&state)?;
        let (groups, roots) = {
            let g = lock(&state.scan);
            let sc = g.as_ref().ok_or("请先扫描")?;
            (sc.dupes.as_ref().map(|d| d.1.clone()).ok_or("请先打开重复文件页面")?, sc.result.roots.clone())
        };
        let app_dir = app_data(&state);
        let mut rc = Receipt::default();
        let mut rec = UndoRecord::default();
        let mut gone = Vec::new();
        for s in sel {
            let Some(paths) = groups.get(&s.group_id) else { continue };
            let Some(keep) = paths.get(s.keep) else { continue };
            // re-check right now that every copy is still byte-identical to the one we keep
            let Some(kh) = finder::full_hash(keep) else {
                rc.skipped.push(Skipped { name: keep.display().to_string(), reason: "要保留的原件读不到了，这一组没有处理".into() });
                continue;
            };
            for (i, p) in paths.iter().enumerate() {
                if i == s.keep { continue; }
                let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                if finder::full_hash(p) != Some(kh) {
                    rc.skipped.push(Skipped { name, reason: "扫描后内容变了，不再和原件相同".into() });
                    continue;
                }
                let o = recycle::recycle(std::slice::from_ref(p), &roots, &app_dir);
                rc.skipped.extend(o.skipped);
                for (q, b) in o.recycled {
                    let id = format!("{}:{i}", s.group_id);
                    rc.bin += gb(b);
                    rc.items.push(ReceiptItem { id: id.clone(), name: format!("{name} · {}", crate::paths::display(q.parent().unwrap_or(&q))), act: "recycle".into(), level: "L2".into(), gb: gb(b), undoable: true });
                    rec.recycled.insert(id, vec![q.to_string_lossy().to_string()]);
                    gone.push(q);
                }
            }
        }
        forget_in_scan(&state, &gone);
        let n = rc.items.len();
        Ok(finish(&state, rc, rec, "clean", format!("重复文件 {n} 份副本移入回收站"), "每组保留一份原件，30 天内可撤销".into()))
    }).await
}

// ---------------- migration

pub struct Migration {
    pub move_id: String,
    pub ctl: Arc<Control>,
}

fn apps_for(move_id: &str) -> (Vec<String>, String) {
    let (names, label): (&[&str], &str) = match move_id {
        "m_ollama" => (&["ollama.exe", "ollama app.exe"], "Ollama"),
        "m_wx" => (&["wechat.exe", "weixin.exe"], "微信"),
        "m_docker" => (&["docker desktop.exe", "com.docker.backend.exe"], "Docker Desktop"),
        "m_wsl" => (&["wsl.exe", "wslhost.exe"], "WSL"),
        _ => (&[], ""),
    };
    (names.iter().map(|s| s.to_string()).collect(), label.to_string())
}

#[tauri::command]
pub fn start_migration(app: AppHandle, state: State<AppState>, move_id: String, to: String, opts: MigrateOptions) -> CmdResult<()> {
    writable(&state)?;
    if lock(&state.migration).is_some() { return Err("已经有一个迁移在进行".into()); }
    let (src, drive, roots) = {
        let g = lock(&state.scan);
        let sc = g.as_ref().ok_or("请先扫描")?;
        let mv = sc.built.model.moves.iter().find(|m| m.id == move_id).ok_or("找不到这个迁移计划")?;
        let cell = mv.cells.first().ok_or("迁移计划是空的")?;
        let src = sc.built.plans.get(cell).and_then(|p| p.paths.first().cloned()).ok_or("找不到源文件夹")?;
        (src, sc.drive.clone(), sc.result.roots.clone())
    };
    let dst = PathBuf::from(crate::paths::expand_env(to.trim()));
    let dst_drive = dst.to_string_lossy().chars().next().map(|c| c.to_ascii_uppercase().to_string()).unwrap_or_default();
    let (apps, label) = apps_for(&move_id);
    let job = Job { src: src.clone(), dst: dst.clone(), link: opts.link, verify: opts.verify, apps, app_label: label };
    let app_dir = app_data(&state);
    // refuse obviously bad jobs right away, before showing progress
    migrate::preflight(&job, &roots, &app_dir, &Probes { free_bytes: &migrate::free_bytes, running: &|_| false })?;
    let ctl = Arc::new(Control::default());
    *lock(&state.migration) = Some(Migration { move_id: move_id.clone(), ctl: ctl.clone() });
    let _ = drive;
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let send = |pct: f64, st: &'static str, gbv: f64, msg: Option<String>| {
            let _ = app.emit("migration-progress", MigrationProgress { move_id: move_id.clone(), pct, state: st, drive: dst_drive.clone(), gb: gbv, message: msg });
        };
        let probes = Probes { free_bytes: &migrate::free_bytes, running: &migrate::running };
        let res = migrate::run(&job, &roots, &app_dir, &ctl, &probes, |e| match e {
            Event::Progress(p) => send(p, "running", 0.0, None),
            Event::Paused(p, m) => send(p, "paused", 0.0, Some(m)),
            Event::Done(_) => {}
        });
        *lock(&state.migration) = None;
        match res {
            Ok(fin) => {
                forget_in_scan(&state, std::slice::from_ref(&job.src));
                let backup = fin.recycled_backup.clone().or(fin.kept_backup.clone()).unwrap_or_default();
                let rec = UndoRecord { migration: Some((job.src.to_string_lossy().to_string(), backup.to_string_lossy().to_string(), fin.recycled_backup.is_some())), ..Default::default() };
                let g = gb(fin.bytes);
                let rc = Receipt { items: vec![ReceiptItem { id: move_id.clone(), name: job.src.display().to_string(), act: "keep".into(), level: "L4".into(), gb: g, undoable: true }], ..Default::default() };
                let note = match &fin.kept_backup {
                    Some(b) => format!("回收站放不下旧文件夹，备份留在 {}，确认无误后可以手动删除", b.display()),
                    None if fin.linked => "原处留了目录联接，原路径照常可用".into(),
                    None => "原路径没有保留联接".into(),
                };
                let mut st = lock(&state.store);
                let id = st.next_id("r");
                st.log(ActivityEvent { id: String::new(), day: String::new(), time: String::new(), kind: "move".into(),
                    title: format!("迁移 {} → {}", job.src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), job.dst.display()),
                    detail: note.clone(), amount: format!("{g:.1} GB"), undo: format!("搬回 {}:", job.src.to_string_lossy().chars().next().unwrap_or('C')),
                    items: vec![], undone: false, at: 0, receipt: Some(id.clone()) });
                st.data.undo.insert(id, UndoRecord { receipt: rc, at: now_ms(), ..rec });
                st.save();
                drop(st);
                let _ = app.emit("migration-progress", MigrationProgress { move_id: move_id.clone(), pct: 100.0, state: "done", drive: dst_drive.clone(), gb: g, message: Some(note) });
            }
            Err(e) => send(0.0, "error", 0.0, Some(e)),
        }
    });
    Ok(())
}

#[tauri::command]
pub fn resume_migration(state: State<AppState>, move_id: String) -> CmdResult<()> {
    let g = lock(&state.migration);
    let m = g.as_ref().filter(|m| m.move_id == move_id).ok_or("没有暂停中的迁移")?;
    m.ctl.paused.store(false, Ordering::Relaxed);
    Ok(())
}

// ---------------- rules

fn rule_roots(state: &AppState) -> CmdResult<Roots> {
    roots_for(state, &crate::drives::system_drive())
}

#[tauri::command]
pub fn dry_run_rule(state: State<AppState>, id: String) -> CmdResult<RuleRun> {
    let rule = lock(&state.store).data.rules.iter().find(|r| r.id == id).cloned().ok_or("找不到这条规则")?;
    let roots = rule_roots(&state)?;
    let Ok(spec) = rules::parse(&rule, &roots) else { return Ok(RuleRun::default()) };
    let m = rules::matches(&spec);
    Ok(RuleRun { n: m.len(), gb: gb(m.iter().map(|x| x.1).sum()), files: m.iter().take(50).map(|(p, b)| (p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), gb(*b))).collect() })
}

fn execute_rule(state: &AppState, id: &str) -> CmdResult<(RuleRun, String)> {
    writable(state)?;
    let rule = lock(&state.store).data.rules.iter().find(|r| r.id == id).cloned().ok_or("找不到这条规则")?;
    let roots = rule_roots(state)?;
    let spec = rules::parse(&rule, &roots)?;
    let files = rules::matches(&spec);
    let o = rules::run(&spec, &files, &roots, &app_data(state));
    let mut rc = Receipt::default();
    let mut rec = UndoRecord::default();
    let mut done: Vec<(String, f64)> = Vec::new();
    for (p, b) in &o.recycled {
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        rc.bin += gb(*b);
        rc.items.push(ReceiptItem { id: name.clone(), name: name.clone(), act: "recycle".into(), level: rule.lv.clone(), gb: gb(*b), undoable: true });
        rec.recycled.insert(name.clone(), vec![p.to_string_lossy().to_string()]);
        done.push((name, gb(*b)));
    }
    for (f, t, b) in &o.moved {
        let name = f.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        rc.items.push(ReceiptItem { id: name.clone(), name: name.clone(), act: "keep".into(), level: rule.lv.clone(), gb: gb(*b), undoable: true });
        rec.moved.insert(name.clone(), vec![(f.to_string_lossy().to_string(), t.to_string_lossy().to_string())]);
        done.push((name, gb(*b)));
    }
    rc.skipped = o.skipped;
    let total: f64 = done.iter().map(|d| d.1).sum();
    let run = RuleRun { n: done.len(), gb: total, files: done };
    let rc = finish(state, rc, rec, "rule", format!("规则「{}」", rule.name), format!("{} 个文件", run.n));
    let mut st = lock(&state.store);
    if let Some(r) = st.data.rules.iter_mut().find(|r| r.id == id) {
        r.last = format!("{} · {} 个文件{}", crate::timefmt::hhmm(now_ms()), run.n, if total >= 0.5 { format!(" · {}", fmt_gb(total)) } else { String::new() });
        r.last_run = now_ms();
    }
    st.save();
    Ok((run, rc.id))
}

#[tauri::command]
pub async fn run_rule(app: AppHandle, id: String) -> CmdResult<serde_json::Value> {
    let a = app.clone();
    blocking(move || {
        let (run, receipt_id) = execute_rule(&a.state::<AppState>(), &id)?;
        Ok(serde_json::json!({ "run": run, "receiptId": receipt_id }))
    }).await
}

/// Background scheduler: runs enabled rules when they are due (checked every 10 minutes).
pub fn start_scheduler(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(60));
        let state = app.state::<AppState>();
        let due: Vec<String> = {
            let st = lock(&state.store);
            if st.data.settings.read_only { Vec::new() } else {
            let now = now_ms();
            st.data.rules.iter().filter(|r| r.on).filter(|r| {
                let every = match r.sched.as_str() { "new" => 10 * 60_000, "day" => 86_400_000, "week" => 7 * 86_400_000, "month" => 30 * 86_400_000, _ => i64::MAX };
                now - r.last_run >= every
            }).map(|r| r.id.clone()).collect()
            }
        };
        for id in due {
            match execute_rule(&state, &id) {
                Ok((run, _)) => log::info!("rule {id}: {} file(s)", run.n),
                Err(e) => {
                    log::warn!("rule {id} not run: {e}");
                    // don't retry a broken rule every minute
                    let mut st = lock(&state.store);
                    if let Some(r) = st.data.rules.iter_mut().find(|r| r.id == id) { r.last_run = now_ms(); r.last = format!("没有运行：{e}"); }
                    st.save();
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(9 * 60));
    });
}

