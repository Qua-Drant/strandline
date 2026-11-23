//! Strandline backend: read-only scanning, Recycle-Bin-first cleaning, verified migration,
//! rules and local persistence. Every write goes through `guard` first.

pub mod catalog;
pub mod drives;
pub mod finder;
pub mod guard;
pub mod model;
pub mod paths;
pub mod sandbox;
pub mod scan;
pub mod store;
pub mod timefmt;
#[cfg(test)]
mod testutil;

mod commands;

use std::collections::HashSet;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use store::Store;

pub struct AppState {
    pub store: Mutex<Store>,
    /// last scan (map model, suggestions, file index)
    pub scan: Mutex<Option<commands::Scanned>>,
    pub cancel: Arc<AtomicBool>,
    /// map blocks cleaned since the last scan
    pub cleaned: Mutex<HashSet<String>>,
}

impl AppState {
    pub fn new(store: Store) -> Self {
        AppState { store: Mutex::new(store), scan: Mutex::new(None), cancel: Arc::new(AtomicBool::new(false)), cleaned: Mutex::new(HashSet::new()) }
    }
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            Ok(())
        })
        .manage(AppState::new(Store::open(Store::default_dir())))
        .invoke_handler(tauri::generate_handler![
            commands::list_drives, commands::get_map_model, commands::scan_drive, commands::cancel_scan,
            commands::get_suggestions, commands::clean_items, commands::undo_item, commands::undo_receipt,
            commands::find_large, commands::recycle_files, commands::find_duplicates, commands::recycle_duplicates,
            commands::start_migration, commands::resume_migration,
            commands::list_rules, commands::rule_templates, commands::save_rule, commands::dry_run_rule, commands::run_rule,
            commands::list_activity, commands::undo_activity, commands::get_overview, commands::get_history,
            commands::get_settings, commands::save_settings, commands::open_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Strandline");
}
