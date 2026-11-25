//! Strandline backend: read-only scanning, Recycle-Bin-first cleaning, verified migration,
//! rules and local persistence. Every write goes through `guard` first.

pub mod catalog;
pub mod drives;
pub mod finder;
pub mod guard;
pub mod migrate;
pub mod model;
pub mod paths;
pub mod recycle;
pub mod rules;
pub mod sandbox;
pub mod scan;
pub mod store;
pub mod timefmt;
pub mod winfs;
#[cfg(test)]
mod testutil;

mod actions;
mod commands;

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use store::Store;

pub struct AppState {
    pub store: Mutex<Store>,
    /// scans per drive / sandbox (map model, suggestions, file index)
    pub scan: Mutex<commands::ScanCache>,
    pub cancel: Arc<AtomicBool>,
    /// the migration in progress, if any
    pub migration: Mutex<Option<actions::Migration>>,
}

impl AppState {
    pub fn new(store: Store) -> Self {
        AppState { store: Mutex::new(store), scan: Mutex::new(commands::ScanCache::default()), cancel: Arc::new(AtomicBool::new(false)), migration: Mutex::new(None) }
    }
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            actions::start_scheduler(app.handle().clone());
            Ok(())
        })
        .manage(AppState::new(Store::open(Store::default_dir())))
        .invoke_handler(tauri::generate_handler![
            commands::list_drives, commands::get_map_model, commands::scan_drive, commands::cancel_scan,
            commands::get_suggestions, actions::clean_items, actions::undo_item, actions::undo_receipt,
            commands::find_large, actions::recycle_files, commands::find_duplicates, actions::recycle_duplicates,
            actions::start_migration, actions::resume_migration, actions::cancel_migration, actions::get_migration_status,
            commands::list_rules, commands::rule_templates, commands::save_rule, commands::delete_rule, actions::dry_run_rule, actions::run_rule,
            commands::list_activity, actions::undo_activity, commands::get_overview, commands::get_history,
            commands::get_settings, commands::save_settings, commands::open_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Strandline");
}
