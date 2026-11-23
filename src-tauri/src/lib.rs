//! Strandline backend: read-only scanning, Recycle-Bin-first cleaning, verified migration,
//! rules and local persistence. Every write goes through `guard` first.

pub mod drives;
pub mod model;
pub mod paths;
pub mod store;

mod commands;

use std::sync::Mutex;
use store::Store;

pub struct AppState {
    pub store: Mutex<Store>,
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            Ok(())
        })
        .manage(AppState { store: Mutex::new(Store::open(Store::default_dir())) })
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
