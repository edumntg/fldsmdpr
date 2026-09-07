use crate::AppDb;
use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::State;

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---- kv settings ----

#[tauri::command]
pub fn kv_get(db: State<AppDb>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(err_to_string)?;
    conn.query_row("SELECT value FROM kv WHERE key = ?1", [&key], |r| r.get(0))
        .optional()
        .map_err(err_to_string)
}

#[tauri::command]
pub fn kv_set(db: State<AppDb>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(err_to_string)?;
    conn.execute(
        "INSERT INTO kv(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [&key, &value],
    )
    .map(|_| ())
    .map_err(err_to_string)
}

// ---- secrets (OS keychain) ----

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    crate::secrets::get(&key).map_err(err_to_string)
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    crate::secrets::set(&key, &value).map_err(err_to_string)
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    crate::secrets::delete(&key).map_err(err_to_string)
}

// ---- diagnostics ----

#[derive(Serialize)]
pub struct AppInfo {
    pub version: String,
    pub db_path: String,
    pub notification_count: i64,
}

#[tauri::command]
pub fn app_info(app: tauri::AppHandle, db: State<AppDb>) -> Result<AppInfo, String> {
    use tauri::Manager;
    let conn = db.0.lock().map_err(err_to_string)?;
    let notification_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM notifications", [], |r| r.get(0))
        .map_err(err_to_string)?;
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(err_to_string)?
        .join("fldsmdpr.db");
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        db_path: db_path.display().to_string(),
        notification_count,
    })
}
