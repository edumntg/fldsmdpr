use crate::AppDb;
use serde::Serialize;
use serde_json::json;
use tauri::State;

pub const PROVIDERS: &[&str] = &["github", "slack", "linear", "gcal", "sentry"];

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
                .is_some()
                // Calendar can also be backed by the local macOS Calendar (no token).
                || (*p == "gcal"
                    && crate::calendar::is_enabled(&conn)
                    && !crate::calendar::selected_calendars(&conn).is_empty());
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
            crate::connectors::slack::validate(&crate::connectors::slack::SlackAuth {
                token: token.to_string(),
                cookie: None,
            })
            .await
        }
        "gcal" => crate::connectors::gcal::validate(token).await,
        "sentry" => crate::connectors::sentry::validate(token).await,
        other => Err(format!("Unknown provider: {other}")),
    }
}

fn now_secs() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
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

/// Full Sentry issue context (stack trace, tags) for the detail pane and the
/// fix-agent prompt. `issue_id` is the bare Sentry id (no "sentry:" prefix).
#[tauri::command]
pub async fn sentry_issue_detail(
    issue_id: String,
) -> Result<crate::connectors::sentry::SentryIssueDetail, String> {
    let token = crate::secrets::get(&token_key("sentry"))
        .map_err(|e| e.to_string())?
        .ok_or("Sentry is not connected")?;
    crate::connectors::sentry::issue_detail(&token, &issue_id).await
}

/// Linear teams + states/projects/members for the create-ticket form.
#[tauri::command]
pub async fn linear_meta() -> Result<serde_json::Value, String> {
    let token = crate::secrets::get(&token_key("linear"))
        .map_err(|e| e.to_string())?
        .ok_or("Linear is not connected")?;
    crate::connectors::linear::meta(&token).await
}

#[tauri::command]
pub async fn linear_create_issue(
    issue: crate::connectors::linear::NewIssue,
) -> Result<serde_json::Value, String> {
    let token = crate::secrets::get(&token_key("linear"))
        .map_err(|e| e.to_string())?
        .ok_or("Linear is not connected")?;
    crate::connectors::linear::create_issue(&token, issue).await
}

/// Submit a PR review from the detail pane. `event`: APPROVE | REQUEST_CHANGES | COMMENT.
#[tauri::command]
pub async fn github_pr_review(
    repo: String,
    number: i64,
    event: String,
    body: String,
) -> Result<(), String> {
    let token = crate::secrets::get(&token_key("github"))
        .map_err(|e| e.to_string())?
        .ok_or("GitHub is not connected")?;
    crate::connectors::github::pr_review(&token, &repo, number, &event, &body).await
}

/// Merge a PR. `method`: merge | squash | rebase.
#[tauri::command]
pub async fn github_pr_merge(repo: String, number: i64, method: String) -> Result<(), String> {
    let token = crate::secrets::get(&token_key("github"))
        .map_err(|e| e.to_string())?
        .ok_or("GitHub is not connected")?;
    crate::connectors::github::pr_merge(&token, &repo, number, &method).await
}

/// Update a Linear issue's state and/or assignee. `assignee_id` accepts the
/// literal "me" (resolved to the token owner).
#[tauri::command]
pub async fn linear_update_issue(
    issue_id: String,
    state_id: Option<String>,
    assignee_id: Option<String>,
) -> Result<(), String> {
    let token = crate::secrets::get(&token_key("linear"))
        .map_err(|e| e.to_string())?
        .ok_or("Linear is not connected")?;
    let assignee = match assignee_id.as_deref() {
        Some("me") => Some(crate::connectors::linear::viewer_id(&token).await?),
        other => other.map(String::from),
    };
    crate::connectors::linear::update_issue(&token, &issue_id, state_id, assignee).await
}

#[tauri::command]
pub async fn linear_add_comment(issue_id: String, body: String) -> Result<(), String> {
    let token = crate::secrets::get(&token_key("linear"))
        .map_err(|e| e.to_string())?
        .ok_or("Linear is not connected")?;
    crate::connectors::linear::add_comment(&token, &issue_id, &body).await
}

/// Full PR context (description, branches, files changed with diffs) fetched
/// on demand when a PR is opened in the detail pane.
#[tauri::command]
pub async fn github_pr_detail(
    repo: String,
    number: i64,
) -> Result<crate::connectors::github::PrDetail, String> {
    let token = crate::secrets::get(&token_key("github"))
        .map_err(|e| e.to_string())?
        .ok_or("GitHub is not connected")?;
    crate::connectors::github::pr_detail(&token, &repo, number).await
}

#[tauri::command]
pub async fn run_sync(app: tauri::AppHandle, db: State<'_, AppDb>) -> Result<SyncResult, String> {
    let mut synced: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut fetched: Vec<crate::connectors::Fetched> = Vec::new();

    // Sources safe to auto-resolve this round. A source only qualifies when its
    // fetch was BOTH successful and complete — resolving from a partial view
    // permanently marks still-open items done.
    let mut resolve_sources: Vec<&'static str> = Vec::new();

    if let Ok(Some(token)) = crate::secrets::get(&token_key("github")) {
        match crate::connectors::github::fetch(&token).await {
            Ok((items, complete)) => {
                fetched.extend(items);
                synced.push("github".into());
                if complete {
                    resolve_sources.push("github");
                }
            }
            Err(e) => errors.push(format!("github: {e}")),
        }
    }
    if let Ok(Some(token)) = crate::secrets::get(&token_key("linear")) {
        match crate::connectors::linear::fetch(&token).await {
            Ok(items) => {
                fetched.extend(items);
                synced.push("linear".into());
                resolve_sources.push("linear");
            }
            Err(e) => errors.push(format!("linear: {e}")),
        }
    }
    if let Ok(Some(token)) = crate::secrets::get(&token_key("sentry")) {
        match crate::connectors::sentry::fetch(&token).await {
            Ok((items, complete)) => {
                fetched.extend(items);
                synced.push("sentry".into());
                if complete {
                    resolve_sources.push("sentry");
                }
            }
            Err(e) => errors.push(format!("sentry: {e}")),
        }
    }
    // Slack fast path (session token, milliseconds): opted-in channels + DMs,
    // explicit mentions always, implicit relevance and unanswered asks judged
    // by Jev when configured. Never auto-resolved: messages are point-in-time.
    {
        let (enabled, channels, since, jev_key, about_me) = {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            let enabled = crate::slack::is_enabled(&conn);
            let since = {
                let last = crate::slack::last_ts(&conn);
                let day_ago = (now_secs() - 86_400.0).max(0.0);
                // 10 min overlap; a first run reads the last 24 h.
                if last > 0.0 {
                    (last - 600.0).max(day_ago)
                } else {
                    day_ago
                }
            };
            (
                enabled,
                crate::slack::opted_in_channels(&conn)
                    .into_iter()
                    .map(|c| (c.id, c.name))
                    .collect::<Vec<_>>(),
                since,
                crate::jev::ready(&conn),
                crate::jev::profile_text(&conn),
            )
        };
        if enabled {
            if let Ok(Some(auth)) = crate::slack::load_auth() {
                match crate::connectors::slack::fetch(
                    &auth,
                    &channels,
                    since,
                    jev_key.as_deref(),
                    &about_me,
                )
                .await
                {
                    Ok((items, newest)) => {
                        fetched.extend(items);
                        synced.push("slack".into());
                        let conn = db.0.lock().map_err(|e| e.to_string())?;
                        crate::slack::set_last_ts(&conn, newest);
                    }
                    Err(e) => errors.push(format!("slack: {e}")),
                }
            }
        }
    }

    // Calendar has two backends sharing source "gcal" (secret ICS URL + local
    // macOS Calendar); resolving is only safe when every enabled backend
    // succeeded, otherwise one backend's transient failure clears the other's events.
    let mut gcal_enabled = false;
    let mut gcal_all_ok = true;
    if let Ok(Some(url)) = crate::secrets::get(&token_key("gcal")) {
        gcal_enabled = true;
        match crate::connectors::gcal::fetch(&url).await {
            Ok(items) => fetched.extend(items),
            Err(e) => {
                gcal_all_ok = false;
                errors.push(format!("gcal: {e}"));
            }
        }
    }
    {
        let (enabled, cals) = {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            (
                crate::calendar::is_enabled(&conn),
                crate::calendar::selected_calendars(&conn),
            )
        };
        if enabled {
            gcal_enabled = true;
            match crate::connectors::maccal::fetch(&cals) {
                Ok(items) => fetched.extend(items),
                Err(e) => {
                    gcal_all_ok = false;
                    errors.push(format!("calendar: {e}"));
                }
            }
        }
    }
    if gcal_enabled {
        synced.push("gcal".into());
        if gcal_all_ok {
            resolve_sources.push("gcal");
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    let new_count = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let new_count = crate::inbox::upsert(&conn, &fetched)?;
        for p in &resolve_sources {
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

    // AI triage: judge new/changed items and link Sentry errors to PRs/tickets.
    // Runs only with an OpenRouter key configured; a failure never breaks the sync.
    let jev_key = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::jev::ready(&conn)
    };
    if let Some(key) = jev_key {
        if let Err(e) = crate::jev::run(&db, &key).await {
            errors.push(format!("jev: {e}"));
        }
    }

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
