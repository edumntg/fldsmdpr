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
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if provider == "slack" {
        crate::slack::clear(&conn);
        return Ok(());
    }
    crate::secrets::delete(&token_key(&provider)).map_err(|e| e.to_string())?;
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
            let login = body["login"].as_str().unwrap_or("connected").to_string();

            // A valid token can still be blocked by SAML SSO enforcement —
            // probe a search request, which carries the x-github-sso header.
            let probe = client
                .get("https://api.github.com/search/issues")
                .query(&[("q", "is:open assignee:@me"), ("per_page", "1")])
                .bearer_auth(token)
                .header("X-GitHub-Api-Version", "2022-11-28")
                .send()
                .await
                .map_err(net_err)?;
            if crate::connectors::github::sso_required(&probe) {
                return Err(format!(
                    "Token is valid for @{login}, but your organization enforces SAML SSO. \
                     On github.com/settings/tokens click “Configure SSO” next to the token, \
                     authorize your orgs, then connect again."
                ));
            }
            Ok(login)
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
        "gcal" => crate::connectors::gcal::validate(token).await,
        other => Err(format!("Unknown provider: {other}")),
    }
}

fn net_err(e: reqwest::Error) -> String {
    format!("Network error: {e}")
}

// ---- sync orchestration ----

#[derive(Serialize)]
pub struct SyncResult {
    pub synced_at: i64,
    pub providers: Vec<String>,
    pub new_count: usize,
    /// Per-provider errors; a failing provider must not break the others.
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn run_sync(app: tauri::AppHandle, db: State<'_, AppDb>) -> Result<SyncResult, String> {
    let mut synced: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut fetched: Vec<crate::connectors::Fetched> = Vec::new();

    // Slack/Calendar connectors land in Phases 2-3.
    if let Ok(Some(token)) = crate::secrets::get(&token_key("github")) {
        match crate::connectors::github::fetch(&token).await {
            Ok(items) => {
                fetched.extend(items);
                synced.push("github".into());
            }
            Err(e) => errors.push(format!("github: {e}")),
        }
    }
    if let Ok(Some(token)) = crate::secrets::get(&token_key("linear")) {
        match crate::connectors::linear::fetch(&token).await {
            Ok(items) => {
                fetched.extend(items);
                synced.push("linear".into());
            }
            Err(e) => errors.push(format!("linear: {e}")),
        }
    }
    if let Ok(Some(auth)) = crate::slack::load_auth() {
        // Read opted-in channels under a short lock so the guard is dropped
        // before we await the network fetch.
        let channels: Vec<(String, String)> = {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            crate::slack::opted_in_channels(&conn)
                .into_iter()
                .map(|c| (c.id, c.name))
                .collect()
        };
        match crate::connectors::slack::fetch(&auth, &channels).await {
            Ok(items) => {
                fetched.extend(items);
                synced.push("slack".into());
            }
            Err(e) => errors.push(format!("slack: {e}")),
        }
    }
    if let Ok(Some(url)) = crate::secrets::get(&token_key("gcal")) {
        match crate::connectors::gcal::fetch(&url).await {
            Ok(items) => {
                fetched.extend(items);
                synced.push("gcal".into());
            }
            Err(e) => errors.push(format!("gcal: {e}")),
        }
    }
    // Local macOS Calendar (reads a Google account synced via Internet Accounts).
    {
        let (enabled, cals) = {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            (
                crate::calendar::is_enabled(&conn),
                crate::calendar::selected_calendars(&conn),
            )
        };
        if enabled {
            match crate::connectors::maccal::fetch(&cals) {
                Ok(items) => {
                    fetched.extend(items);
                    if !synced.contains(&"gcal".to_string()) {
                        synced.push("gcal".into());
                    }
                }
                Err(e) => errors.push(format!("calendar: {e}")),
            }
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    let new_count = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let new_count = crate::inbox::upsert(&conn, &fetched)?;
        // Auto-resolve items the provider no longer reports (merged/closed/completed),
        // but only for providers whose fetch actually succeeded.
        for p in &synced {
            let keep: std::collections::HashSet<String> = fetched
                .iter()
                .filter(|f| f.source == *p)
                .map(|f| f.id.clone())
                .collect();
            let _ = crate::inbox::resolve_missing(&conn, p, &keep)?;
        }
        kv_set(&conn, "last_sync_at", &now.to_string());
        for p in &synced {
            kv_set(&conn, &format!("last_sync:{p}"), &now.to_string());
        }
        new_count
    };

    if new_count > 0 {
        use tauri_plugin_notification::NotificationExt;
        let body = if new_count == 1 {
            "1 new item needs your attention".to_string()
        } else {
            format!("{new_count} new items need your attention")
        };
        let _ = app
            .notification()
            .builder()
            .title("FLDSMDPR")
            .body(body)
            .show();
    }

    Ok(SyncResult {
        synced_at: now,
        providers: synced,
        new_count,
        errors,
    })
}
