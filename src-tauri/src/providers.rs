use crate::AppDb;
use serde::Serialize;
use serde_json::json;
use tauri::State;

pub const PROVIDERS: &[&str] = &["github", "slack", "linear", "gcal"];

fn token_key(provider: &str) -> String {
    format!("token:{provider}")
}

fn account_kv_key(provider: &str) -> String {
    format!("account:{provider}")
}

#[derive(Serialize)]
pub struct ProviderStatus {
    pub id: String,
    pub connected: bool,
    pub account: Option<String>,
}

fn kv_get(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    use rusqlite::OptionalExtension;
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

#[tauri::command]
pub fn provider_status(db: State<AppDb>) -> Result<Vec<ProviderStatus>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    PROVIDERS
        .iter()
        .map(|p| {
            let connected = crate::secrets::get(&token_key(p))
                .map_err(|e| e.to_string())?
                .is_some();
            Ok(ProviderStatus {
                id: p.to_string(),
                connected,
                account: if connected {
                    kv_get(&conn, &account_kv_key(p))
                } else {
                    None
                },
            })
        })
        .collect()
}

/// Validates the token against the provider's API, then stores it in the OS
/// keychain. Returns the account label (username/workspace) on success.
#[tauri::command]
pub async fn provider_connect(
    db: State<'_, AppDb>,
    provider: String,
    token: String,
) -> Result<String, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Token is empty".into());
    }
    let account = validate(&provider, &token).await?;
    crate::secrets::set(&token_key(&provider), &token).map_err(|e| e.to_string())?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    kv_set(&conn, &account_kv_key(&provider), &account);
    Ok(account)
}

#[tauri::command]
pub fn provider_disconnect(db: State<AppDb>, provider: String) -> Result<(), String> {
    crate::secrets::delete(&token_key(&provider)).map_err(|e| e.to_string())?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let _ = conn.execute("DELETE FROM kv WHERE key = ?1", [account_kv_key(&provider)]);
    Ok(())
}

async fn validate(provider: &str, token: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("fldsmdpr/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    match provider {
        "github" => {
            let res = client
                .get("https://api.github.com/user")
                .bearer_auth(token)
                .header("X-GitHub-Api-Version", "2022-11-28")
                .send()
                .await
                .map_err(net_err)?;
            if !res.status().is_success() {
                return Err(format!("GitHub rejected the token (HTTP {})", res.status()));
            }
            let body: serde_json::Value = res.json().await.map_err(net_err)?;
            Ok(body["login"].as_str().unwrap_or("connected").to_string())
        }
        "linear" => {
            let res = client
                .post("https://api.linear.app/graphql")
                .header("Authorization", token)
                .json(&json!({ "query": "{ viewer { displayName email } }" }))
                .send()
                .await
                .map_err(net_err)?;
            if !res.status().is_success() {
                return Err(format!("Linear rejected the key (HTTP {})", res.status()));
            }
            let body: serde_json::Value = res.json().await.map_err(net_err)?;
            body["data"]["viewer"]["displayName"]
                .as_str()
                .or(body["data"]["viewer"]["email"].as_str())
                .map(String::from)
                .ok_or_else(|| "Linear rejected the key".to_string())
        }
        "slack" => {
            let res = client
                .post("https://slack.com/api/auth.test")
                .bearer_auth(token)
                .send()
                .await
                .map_err(net_err)?;
            let body: serde_json::Value = res.json().await.map_err(net_err)?;
            if body["ok"].as_bool() != Some(true) {
                return Err(format!(
                    "Slack rejected the token ({})",
                    body["error"].as_str().unwrap_or("unknown error")
                ));
            }
            let user = body["user"].as_str().unwrap_or("connected");
            let team = body["team"].as_str().unwrap_or("");
            Ok(if team.is_empty() {
                user.to_string()
            } else {
                format!("{user} @ {team}")
            })
        }
        "gcal" => Err("Google Calendar uses OAuth — this flow lands in Phase 3.".into()),
        other => Err(format!("Unknown provider: {other}")),
    }
}

fn net_err(e: reqwest::Error) -> String {
    format!("Network error: {e}")
}

// ---- sync orchestration (connectors land in Phases 1-3; this wires the plumbing) ----

#[derive(Serialize)]
pub struct SyncResult {
    pub synced_at: i64,
    pub providers: Vec<String>,
}

#[tauri::command]
pub fn run_sync(db: State<AppDb>) -> Result<SyncResult, String> {
    let connected: Vec<String> = PROVIDERS
        .iter()
        .filter(|p| matches!(crate::secrets::get(&token_key(p)), Ok(Some(_))))
        .map(|p| p.to_string())
        .collect();

    // Per-connector fetch workers land in Phase 1+. For now syncing records the
    // timestamp so open-on-launch / daily-refresh scheduling is fully wired.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    kv_set(&conn, "last_sync_at", &now.to_string());
    for p in &connected {
        kv_set(&conn, &format!("last_sync:{p}"), &now.to_string());
    }

    Ok(SyncResult {
        synced_at: now,
        providers: connected,
    })
}
