use crate::AppDb;
use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::State;

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

fn valid_source(source: &str) -> Result<(), String> {
    match source {
        "notion" | "granola" => Ok(()),
        other => Err(format!("Unknown AI source: {other}")),
    }
}

#[derive(Serialize)]
pub struct AiSourceStatus {
    pub available: bool,
    pub enabled: bool,
    pub last_sync_at: Option<i64>,
    pub last_error: Option<String>,
}

#[tauri::command]
pub fn ai_source_status(db: State<AppDb>, source: String) -> Result<AiSourceStatus, String> {
    valid_source(&source)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(AiSourceStatus {
        available: crate::connectors::slack::claude_bin().is_some(),
        enabled: kv(&conn, &format!("{source}:ai_enabled")).as_deref() == Some("1"),
        last_sync_at: kv(&conn, &format!("{source}:ai_last_sync")).and_then(|s| s.parse().ok()),
        last_error: kv(&conn, &format!("{source}:ai_last_error")).filter(|s| !s.is_empty()),
    })
}

#[tauri::command]
pub fn ai_source_set(db: State<AppDb>, source: String, enabled: bool) -> Result<(), String> {
    valid_source(&source)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    kv_set(
        &conn,
        &format!("{source}:ai_enabled"),
        if enabled { "1" } else { "0" },
    );
    Ok(())
}

/// Runs one AI round for a source (notion | granola) and upserts the items.
/// These are point-in-time findings — never auto-resolved.
#[tauri::command]
pub async fn ai_source_sync(
    app: tauri::AppHandle,
    db: State<'_, AppDb>,
    source: String,
) -> Result<usize, String> {
    valid_source(&source)?;
    let (enabled, about_me) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        (
            kv(&conn, &format!("{source}:ai_enabled")).as_deref() == Some("1"),
            kv(&conn, "slack:about_me").unwrap_or_default(),
        )
    };
    if !enabled {
        return Ok(0);
    }

    let src = source.clone();
    let result = tauri::async_runtime::spawn_blocking(move || match src.as_str() {
        "notion" => crate::connectors::ai_rounds::notion_round(&about_me),
        _ => crate::connectors::ai_rounds::granola_round(),
    })
    .await
    .map_err(|e| e.to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    let items = match result {
        Ok(items) => items,
        Err(e) => {
            let conn = db.0.lock().map_err(|er| er.to_string())?;
            kv_set(&conn, &format!("{source}:ai_last_error"), &e);
            return Err(e);
        }
    };

    let new_count = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let n = crate::inbox::upsert(&conn, &items)?;
        kv_set(&conn, &format!("{source}:ai_last_sync"), &now.to_string());
        kv_set(&conn, &format!("{source}:ai_last_error"), "");
        n
    };

    if new_count > 0 {
        use tauri_plugin_notification::NotificationExt;
        let label = if source == "notion" {
            "Notion"
        } else {
            "Meetings"
        };
        let _ = app
            .notification()
            .builder()
            .title(format!("FLDSMDPR · {label}"))
            .body(format!(
                "{new_count} new item{}",
                if new_count == 1 { "" } else { "s" }
            ))
            .show();
    }
    Ok(new_count)
}

/// Morning briefing: a native notification summarizing the day, fired by the
/// frontend right after the daily refresh completes.
#[tauri::command]
pub fn morning_briefing(app: tauri::AppHandle, db: State<AppDb>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let count = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0) };
    let prs = count("SELECT COUNT(*) FROM notifications WHERE source='github' AND state IN ('unread','read') AND type='pr_review'");
    let tickets = count(
        "SELECT COUNT(*) FROM notifications WHERE source='linear' AND state IN ('unread','read')",
    );
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    let next_meeting: Option<String> = conn
        .query_row(
            "SELECT title FROM notifications WHERE source='gcal' AND created_at > ?1
             AND state != 'done' ORDER BY created_at ASC LIMIT 1",
            [now_ms],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let mut parts = vec![format!(
        "{prs} PR review{}",
        if prs == 1 { "" } else { "s" }
    )];
    parts.push(format!(
        "{tickets} ticket{}",
        if tickets == 1 { "" } else { "s" }
    ));
    if let Some(m) = next_meeting {
        parts.push(format!("next: {}", m.chars().take(40).collect::<String>()));
    }

    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title("Good morning — your day at a glance")
        .body(parts.join(" · "))
        .show();
    Ok(())
}
