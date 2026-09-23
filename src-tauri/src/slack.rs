use crate::connectors::slack::{self, SlackAuth};
use crate::AppDb;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

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
    if xoxc.is_empty() {
        return Err("Paste your xoxc- token".into());
    }
    persist(&db, &xoxc, xoxd.trim()).await
}

/// Validates a session against Slack, then stores it in the keychain and
/// records the account name. Shared by both connect paths (guided sign-in and
/// the manual paste fallback) so they can't drift apart.
async fn persist(db: &State<'_, AppDb>, xoxc: &str, xoxd: &str) -> Result<String, String> {
    let auth = SlackAuth {
        token: xoxc.to_string(),
        cookie: (!xoxd.is_empty()).then(|| xoxd.to_string()),
    };
    let account = slack::validate(&auth).await?;

    crate::secrets::set(XOXC_KEY, xoxc).map_err(|e| e.to_string())?;
    if xoxd.is_empty() {
        let _ = crate::secrets::delete(XOXD_KEY);
    } else {
        crate::secrets::set(XOXD_KEY, xoxd).map_err(|e| e.to_string())?;
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

const SIGNIN_LABEL: &str = "slack-signin";
/// The sign-in form, not `app.slack.com` — that one just serves the marketing
/// site to a signed-out visitor, with no way to log in.
const SIGNIN_URL: &str = "https://slack.com/signin";
/// Cookies are set domain-wide on `.slack.com`, so look them up at the apex.
const COOKIE_URL: &str = "https://slack.com/";
/// The web client. Only this writes the token into `localStorage`.
const CLIENT_URL: &str = "https://app.slack.com/client";
const CLIENT_HOST: &str = "app.slack.com";
/// After signing in Slack parks you on a "Ready to launch" page whose button
/// hands off to the *desktop* app, which a webview cannot do — so the click
/// appears to do nothing. Nudge the window to the web client instead.
// ponytail: two nudges; more would fight the user if Slack bounces us back,
// e.g. onto a workspace picker.
const MAX_CLIENT_NUDGES: u8 = 2;

/// WKWebView's stock user agent stops at "(KHTML, like Gecko)" with no
/// `Version/… Safari/…` token, and Slack answers that with "your browser is
/// not supported". The engine here really is Safari's, so claiming so is
/// accurate rather than a disguise.
// ponytail: pinned Safari version; bump it if Slack ever calls 26.6 too old.
const SIGNIN_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15";

/// Reads the workspace token out of the Slack web client's own `localStorage`.
/// Returns "" until the client has booted, which only happens once the user is
/// actually signed in — so this doubles as the "sign-in finished" signal.
const READ_TOKEN_JS: &str = r#"(() => {
  try {
    const cfg = JSON.parse(localStorage.localConfig_v2 || "{}");
    const team = Object.values(cfg.teams || {}).find(
      (t) => t && typeof t.token === "string" && t.token.startsWith("xoxc-")
    );
    return team ? team.token : "";
  } catch (e) {
    return "";
  }
})()"#;

/// Guided sign-in: opens Slack in a FLDSMDPR-owned window, waits for the user
/// to log in themselves, then picks up that window's own session — the same
/// token + `d` cookie pair they used to copy out of DevTools by hand.
///
/// The window is deliberately absent from every capability file, so the page
/// can't reach a single Tauri command; we only ever read out of it from Rust.
/// Nothing is taken from the Slack desktop app or from any other browser.
#[tauri::command]
pub async fn slack_sign_in(app: tauri::AppHandle, db: State<'_, AppDb>) -> Result<String, String> {
    if let Some(existing) = app.get_webview_window(SIGNIN_LABEL) {
        let _ = existing.close();
    }
    let url = SIGNIN_URL.parse().map_err(|_| "bad sign-in url")?;
    let win =
        tauri::WebviewWindowBuilder::new(&app, SIGNIN_LABEL, tauri::WebviewUrl::External(url))
            .title("Sign in to Slack — FLDSMDPR")
            .user_agent(SIGNIN_UA)
            .inner_size(1040.0, 780.0)
            .center()
            .build()
            .map_err(|e| e.to_string())?;

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(600);
    let mut nudges = 0u8;
    let (token, cookie) = loop {
        tokio::time::sleep(std::time::Duration::from_millis(1200)).await;

        if app.get_webview_window(SIGNIN_LABEL).is_none() {
            return Err("Sign-in cancelled — the Slack window was closed.".into());
        }
        if std::time::Instant::now() > deadline {
            let _ = win.close();
            return Err(
                "Timed out waiting for Slack to load your workspace. If the \
Slack window showed a “Ready to launch” screen, use its “open in browser” link \
rather than the launch button, then try again."
                    .into(),
            );
        }

        // The cookie lands at login; the token only once the web client boots.
        let Some(cookie) = session_cookie(&win) else {
            continue;
        };
        if let Some(token) = read_token(&win).await {
            break (token, cookie);
        }

        // Signed in but no token yet, so we are sitting on a page that is not
        // the client — almost always the "Ready to launch" hand-off. Move.
        let on_client = win
            .url()
            .map(|u| u.host_str() == Some(CLIENT_HOST))
            .unwrap_or(false);
        if !on_client && nudges < MAX_CLIENT_NUDGES {
            nudges += 1;
            if let Ok(url) = CLIENT_URL.parse() {
                let _ = win.navigate(url);
            }
        }
    };
    let _ = win.close();
    persist(&db, &token, &cookie).await
}

/// The `d` session cookie from our own sign-in window. It is HttpOnly, so it
/// is read through the webview cookie store rather than from JavaScript.
fn session_cookie(win: &tauri::WebviewWindow) -> Option<String> {
    let url = COOKIE_URL.parse().ok()?;
    let cookie = win
        .cookies_for_url(url)
        .ok()?
        .into_iter()
        .find(|c| c.name() == "d")?;
    let value = cookie.value().to_string();
    value.starts_with("xoxd-").then_some(value)
}

async fn read_token(win: &tauri::WebviewWindow) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    // `eval_with_callback` wants an `Fn`, so the one-shot sender is taken out
    // under a lock instead of being moved into the closure.
    let tx = std::sync::Mutex::new(Some(tx));
    win.eval_with_callback(READ_TOKEN_JS, move |json| {
        if let Ok(mut slot) = tx.lock() {
            if let Some(tx) = slot.take() {
                let _ = tx.send(json);
            }
        }
    })
    .ok()?;

    let json = tokio::time::timeout(std::time::Duration::from_secs(5), rx)
        .await
        .ok()?
        .ok()?;
    parse_token(&json)
}

/// `eval_with_callback` hands back the JS result JSON-encoded, so a token
/// arrives as `"\"xoxc-…\""` and "not signed in yet" as `"\"\""`.
fn parse_token(json: &str) -> Option<String> {
    let token: String = serde_json::from_str(json).ok()?;
    token.starts_with("xoxc-").then_some(token)
}

#[cfg(test)]
mod tests {
    use super::{parse_token, SIGNIN_UA};

    /// Slack serves "your browser is not supported" unless the agent carries a
    /// `Version/… Safari/…` token, and the line continuation above is easy to
    /// break into a doubled or missing space.
    #[test]
    fn signin_user_agent_is_a_well_formed_safari_string() {
        assert_eq!(
            SIGNIN_UA,
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
(KHTML, like Gecko) Version/26.6 Safari/605.1.15"
        );
        assert!(
            SIGNIN_UA.contains(" Version/"),
            "Slack requires a Version token"
        );
        assert!(SIGNIN_UA.ends_with(" Safari/605.1.15"));
        assert!(
            !SIGNIN_UA.contains("  "),
            "doubled space would be a broken continuation"
        );
    }

    #[test]
    fn parse_token_accepts_only_a_real_session_token() {
        assert_eq!(
            parse_token("\"xoxc-abc123\""),
            Some("xoxc-abc123".to_string())
        );
        // Web client not booted yet — keep polling, do not connect.
        assert_eq!(parse_token("\"\""), None);
        // Some other token shape, or JS threw and the value is not a string.
        assert_eq!(parse_token("\"xoxb-abc\""), None);
        assert_eq!(parse_token("null"), None);
        assert_eq!(parse_token(""), None);
    }
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

/// Resolves a pasted channel link or bare ID to {id, name}. Used when the org
/// restricts users.conversations (enterprise_is_restricted) so the user can add
/// channels manually instead of picking from a list.
#[tauri::command]
pub async fn slack_resolve_channel(id_or_url: String) -> Result<SlackChannel, String> {
    let auth = load_auth()?.ok_or("Slack isn't connected")?;
    let id = extract_channel_id(&id_or_url)
        .ok_or("Paste a channel link (Slack → channel → Copy link) or an ID like C0ABC123.")?;
    let name = slack::channel_name(&auth, &id)
        .await
        .unwrap_or_else(|_| id.clone());
    Ok(SlackChannel { id, name })
}

fn extract_channel_id(s: &str) -> Option<String> {
    let s = s.trim();
    // From a message/channel link: .../archives/C0ABC123[/p...]
    if let Some(pos) = s.find("/archives/") {
        let id: String = s[pos + "/archives/".len()..]
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect();
        if is_channel_id(&id) {
            return Some(id);
        }
    }
    // A bare id pasted directly.
    let bare: String = s
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric())
        .collect();
    if is_channel_id(&bare) {
        return Some(bare);
    }
    None
}

fn is_channel_id(s: &str) -> bool {
    s.len() >= 7 && matches!(s.chars().next(), Some('C' | 'G' | 'D'))
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

// ---- Slack via headless claude + MCP (primary path) ----

/// Master switch: Slack is opt-in. Off → no section, no fetch, no analysis.
const ENABLED_KV: &str = "slack:enabled";
/// Day/week summaries via headless claude — the slow part, so separately opt-in.
const SUMMARIES_KV: &str = "slack:summaries";
/// Newest message ts seen by the fast path (incremental reads).
pub const LAST_TS_KV: &str = "slack:last_ts";
const AI_LAST_SYNC_KV: &str = "slack:ai_last_sync";
const DAY_SUMMARY_KV: &str = "slack:day_summary";
const WEEK_SUMMARY_KV: &str = "slack:week_summary";

fn kv_get(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

fn kv_put(conn: &rusqlite::Connection, key: &str, value: &str) {
    let _ = conn.execute(
        "INSERT INTO kv(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    );
}

#[derive(Serialize)]
pub struct SlackAiStatus {
    pub available: bool,
    pub enabled: bool,
    pub summaries: bool,
    pub last_sync_at: Option<i64>,
    pub day_summary: String,
    pub week_summary: String,
}

#[tauri::command]
pub fn slack_ai_status(db: State<AppDb>) -> Result<SlackAiStatus, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(SlackAiStatus {
        available: crate::claude_cli::claude_bin().is_some(),
        enabled: is_enabled(&conn),
        summaries: kv_get(&conn, SUMMARIES_KV).as_deref() == Some("1"),
        last_sync_at: kv_get(&conn, AI_LAST_SYNC_KV).and_then(|s| s.parse().ok()),
        day_summary: kv_get(&conn, DAY_SUMMARY_KV).unwrap_or_default(),
        week_summary: kv_get(&conn, WEEK_SUMMARY_KV).unwrap_or_default(),
    })
}

/// Verifies the claude CLI has the Slack MCP connected (runs `claude mcp list`,
/// which is slow — only call on an explicit user action).
#[tauri::command]
pub async fn slack_ai_check() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(crate::connectors::slack::claude_slack_ready)
        .await
        .map_err(|e| e.to_string())
}

pub fn is_enabled(conn: &rusqlite::Connection) -> bool {
    kv_get(conn, ENABLED_KV).as_deref() == Some("1")
}

#[tauri::command]
pub fn slack_set_summaries(db: State<AppDb>, enabled: bool) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    kv_put(&conn, SUMMARIES_KV, if enabled { "1" } else { "0" });
    Ok(())
}

/// Fast-path cursor: newest Slack ts already read (0 = never).
pub fn last_ts(conn: &rusqlite::Connection) -> f64 {
    kv_get(conn, LAST_TS_KV)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0)
}

pub fn set_last_ts(conn: &rusqlite::Connection, ts: f64) {
    kv_put(conn, LAST_TS_KV, &format!("{ts:.6}"));
}

#[tauri::command]
pub fn slack_set_enabled(db: State<AppDb>, enabled: bool) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    kv_put(&conn, ENABLED_KV, if enabled { "1" } else { "0" });
    Ok(())
}

/// Runs the (slow) Slack-via-claude fetch and upserts results. Called on its own
/// slower cadence by the frontend, not from the fast run_sync.
#[tauri::command]
pub async fn slack_ai_sync(app: tauri::AppHandle, db: State<'_, AppDb>) -> Result<usize, String> {
    let (enabled, about_me, incr) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis() as i64;
        // Incremental round when the last one is recent enough (< 7 days):
        // claude only reads messages after it (30 min overlap for safety) and
        // merges them into the stored summaries instead of re-reading the week.
        let incr = kv_get(&conn, AI_LAST_SYNC_KV)
            .and_then(|s| s.parse::<i64>().ok())
            .filter(|t| now - t < 7 * 86_400_000)
            .map(|t| crate::connectors::slack::SlackIncremental {
                since_ms: t - 30 * 60_000,
                prev_day: kv_get(&conn, DAY_SUMMARY_KV).unwrap_or_default(),
                prev_week: kv_get(&conn, WEEK_SUMMARY_KV).unwrap_or_default(),
            });
        (
            is_enabled(&conn) && kv_get(&conn, SUMMARIES_KV).as_deref() == Some("1"),
            crate::jev::profile_text(&conn),
            incr,
        )
    };
    if !enabled {
        return Ok(0);
    }

    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::connectors::slack::fetch_via_claude(&about_me, incr.as_ref())
    })
    .await
    .map_err(|e| e.to_string())??;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    let new_count = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let n = crate::inbox::upsert(&conn, &result.items)?;
        kv_put(&conn, AI_LAST_SYNC_KV, &now.to_string());
        kv_put(&conn, DAY_SUMMARY_KV, &result.day_summary);
        kv_put(&conn, WEEK_SUMMARY_KV, &result.week_summary);
        n
    };

    if new_count > 0 {
        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title("FLDSMDPR · Slack")
            .body(if new_count == 1 {
                "1 new Slack item".to_string()
            } else {
                format!("{new_count} new Slack items")
            })
            .show();
    }
    Ok(new_count)
}
