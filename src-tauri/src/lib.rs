mod agents;
mod commands;
mod connectors;
mod db;
mod inbox;
mod providers;
mod secrets;
mod slack;

use std::sync::Mutex;
use tauri::Manager;

/// Shared SQLite handle. All queries are short-lived; a single Mutex'd
/// connection is enough until sync workers land (they'll get their own).
pub struct AppDb(pub Mutex<rusqlite::Connection>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let conn = db::open(&data_dir.join("fldsmdpr.db"))?;
            app.manage(AppDb(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::kv_get,
            commands::kv_set,
            commands::secret_get,
            commands::secret_set,
            commands::secret_delete,
            commands::app_info,
            providers::provider_status,
            providers::provider_connect,
            providers::provider_disconnect,
            providers::run_sync,
            inbox::list_notifications,
            inbox::set_notification_state,
            agents::orca_status,
            agents::launch_orca,
            slack::slack_connect,
            slack::slack_list_channels,
            slack::slack_get_channels,
            slack::slack_set_channels,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
