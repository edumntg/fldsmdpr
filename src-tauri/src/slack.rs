use crate::connectors::slack::{self, SlackAuth};
use crate::AppDb;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::State;

const XOXC_KEY: &str = "token:slack";
const XOXD_KEY: &str = "token:slack_cookie";
const CHANNELS_KV: &str = "slack:channels";

#[derive(Serialize, Deserialize, Clone)]
pub struct SlackChannel {
    pub id: String,
    pub name: String,
}

/// Builds Slack auth from the keychain (xoxc token + optional xoxd cookie).
pub fn load_auth() -> Result<Option<SlackAuth>, String> {
    let Some(token) = crate::secrets::get(XOXC_KEY).map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let cookie = crate::secrets::get(XOXD_KEY).map_err(|e| e.to_string())?;
    Ok(Some(SlackAuth { token, cookie }))
}

pub fn opted_in_channels(conn: &rusqlite::Connection) -> Vec<SlackChannel> {
    conn.query_row("SELECT value FROM kv WHERE key = ?1", [CHANNELS_KV], |r| {
        r.get::<_, String>(0)
    })
    .optional()
    .ok()
    .flatten()
    .and_then(|s| serde_json::from_str(&s).ok())
    .unwrap_or_default()
}

#[tauri::command]
pub async fn slack_connect(
    db: State<'_, AppDb>,
    xoxc: String,
    xoxd: String,
) -> Result<String, String> {
    let xoxc = xoxc.trim().to_string();
    let xoxd = xoxd.trim().to_string();
    if xoxc.is_empty() {
        return Err("Paste your xoxc- token".into());
    }
    let auth = SlackAuth {
        token: xoxc.clone(),
        cookie: if xoxd.is_empty() {
            None
        } else {
            Some(xoxd.clone())
        },
    };
    let account = slack::validate(&auth).await?;

    crate::secrets::set(XOXC_KEY, &xoxc).map_err(|e| e.to_string())?;
    if xoxd.is_empty() {
        let _ = crate::secrets::delete(XOXD_KEY);
    } else {
        crate::secrets::set(XOXD_KEY, &xoxd).map_err(|e| e.to_string())?;
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO kv(key, value) VALUES('account:slack', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [&account],
    )
    .map_err(|e| e.to_string())?;
    Ok(account)
}

#[tauri::command]
pub async fn slack_list_channels() -> Result<Vec<SlackChannel>, String> {
    let auth = load_auth()?.ok_or("Slack isn't connected")?;
    let channels = slack::list_channels(&auth).await?;
    Ok(channels
        .into_iter()
        .map(|(id, name)| SlackChannel { id, name })
        .collect())
}

#[tauri::command]
pub fn slack_get_channels(db: State<AppDb>) -> Result<Vec<SlackChannel>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(opted_in_channels(&conn))
}

#[tauri::command]
pub fn slack_set_channels(db: State<AppDb>, channels: Vec<SlackChannel>) -> Result<(), String> {
    let json = serde_json::to_string(&channels).map_err(|e| e.to_string())?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO kv(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [CHANNELS_KV, &json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Clears all Slack credentials and config (used by provider_disconnect).
pub fn clear(conn: &rusqlite::Connection) {
    let _ = crate::secrets::delete(XOXC_KEY);
    let _ = crate::secrets::delete(XOXD_KEY);
    let _ = conn.execute(
        "DELETE FROM kv WHERE key IN ('account:slack', ?1)",
        [CHANNELS_KV],
    );
}
