use crate::AppDb;
use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::State;

const ENABLED_KV: &str = "maccal:enabled";
const CALS_KV: &str = "maccal:calendars";

#[derive(Serialize)]
pub struct MacCalConfig {
    pub available: bool,
    pub enabled: bool,
    pub calendars: Vec<String>,
}

fn kv(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

fn kv_set(conn: &rusqlite::Connection, key: &str, value: &str) {
    let _ = conn.execute(
        "INSERT INTO kv(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    );
}

pub fn selected_calendars(conn: &rusqlite::Connection) -> Vec<String> {
    kv(conn, CALS_KV)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn is_enabled(conn: &rusqlite::Connection) -> bool {
    kv(conn, ENABLED_KV).as_deref() == Some("1")
}

#[tauri::command]
pub fn maccal_config(db: State<AppDb>) -> Result<MacCalConfig, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(MacCalConfig {
        available: cfg!(target_os = "macos"),
        enabled: is_enabled(&conn),
        calendars: selected_calendars(&conn),
    })
}

#[tauri::command]
pub fn maccal_list_calendars() -> Result<Vec<String>, String> {
    crate::connectors::maccal::list_calendars()
}

#[tauri::command]
pub fn maccal_set_config(
    db: State<AppDb>,
    enabled: bool,
    calendars: Vec<String>,
) -> Result<(), String> {
    let json = serde_json::to_string(&calendars).map_err(|e| e.to_string())?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    kv_set(&conn, ENABLED_KV, if enabled { "1" } else { "0" });
    kv_set(&conn, CALS_KV, &json);
    Ok(())
}
