use crate::connectors::Fetched;
use crate::AppDb;
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

#[derive(Serialize)]
pub struct Relevance {
    pub kind: String,
    pub score: f64,
    pub reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRow {
    pub id: String,
    pub source: String,
    #[serde(rename = "type")]
    pub ntype: String,
    pub title: String,
    pub snippet: String,
    pub url: Option<String>,
    pub created_at: i64,
    pub priority: f64,
    pub state: String,
    pub relevance: Option<Relevance>,
    pub meta: Option<HashMap<String, String>>,
}

#[tauri::command]
pub fn list_notifications(db: State<AppDb>) -> Result<Vec<NotificationRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Wake expired snoozes: they come back as unread.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    conn.execute(
        "UPDATE notifications SET state = 'unread', snoozed_until = NULL
         WHERE state = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= ?1",
        [now],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, source, type, title, snippet, url, created_at, priority, state,
                    relevance_kind, relevance_score, relevance_reason, context_json
             FROM notifications
             WHERE state NOT IN ('done', 'snoozed')
             ORDER BY priority DESC, created_at DESC
             LIMIT 300",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], row_to_notification)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn row_to_notification(r: &rusqlite::Row) -> rusqlite::Result<NotificationRow> {
    let relevance = match (
        r.get::<_, Option<String>>(9)?,
        r.get::<_, Option<f64>>(10)?,
        r.get::<_, Option<String>>(11)?,
    ) {
        (Some(kind), Some(score), Some(reason)) => Some(Relevance {
            kind,
            score,
            reason,
        }),
        _ => None,
    };
    let meta: Option<HashMap<String, String>> = serde_json::from_str(&r.get::<_, String>(12)?).ok();
    Ok(NotificationRow {
        id: r.get(0)?,
        source: r.get(1)?,
        ntype: r.get(2)?,
        title: r.get(3)?,
        snippet: r.get(4)?,
        url: r.get(5)?,
        created_at: r.get(6)?,
        priority: r.get(7)?,
        state: r.get(8)?,
        relevance,
        meta,
    })
}

#[tauri::command]
pub fn set_notification_state(db: State<AppDb>, id: String, state: String) -> Result<(), String> {
    if !["unread", "read", "snoozed", "done"].contains(&state.as_str()) {
        return Err(format!("invalid state: {state}"));
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE notifications SET state = ?2 WHERE id = ?1",
        rusqlite::params![id, state],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Full-text search across ALL notifications, including done/archived ones —
/// nothing that ever reached the inbox is unfindable.
#[tauri::command]
pub fn search_notifications(
    db: State<AppDb>,
    query: String,
) -> Result<Vec<NotificationRow>, String> {
    // Sanitize into FTS5-safe prefix terms.
    let terms: Vec<String> = query
        .split_whitespace()
        .map(|t| {
            t.chars()
                .filter(|c| c.is_alphanumeric())
                .collect::<String>()
        })
        .filter(|t| !t.is_empty())
        .map(|t| format!("{t}*"))
        .collect();
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let fts_query = terms.join(" ");

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT n.id, n.source, n.type, n.title, n.snippet, n.url, n.created_at, n.priority,
                    n.state, n.relevance_kind, n.relevance_score, n.relevance_reason, n.context_json
             FROM notifications_fts f
             JOIN notifications n ON n.rowid = f.rowid
             WHERE notifications_fts MATCH ?1
             ORDER BY rank
             LIMIT 30",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([fts_query], row_to_notification)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Snoozes a notification until `until` (unix ms); it wakes as unread.
#[tauri::command]
pub fn snooze_notification(db: State<AppDb>, id: String, until: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE notifications SET state = 'snoozed', snoozed_until = ?2 WHERE id = ?1",
        rusqlite::params![id, until],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Auto-resolves items that a successful sync no longer returned (merged PRs,
/// closed issues, completed tickets): anything of `source` not in `keep_ids`
/// is marked done so it leaves the inbox without deleting history.
pub fn resolve_missing(
    conn: &rusqlite::Connection,
    source: &str,
    keep_ids: &std::collections::HashSet<String>,
) -> Result<usize, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM notifications WHERE source = ?1 AND state != 'done'")
        .map_err(|e| e.to_string())?;
    let existing: Vec<String> = stmt
        .query_map([source], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    let mut resolved = 0usize;
    for id in existing.iter().filter(|id| !keep_ids.contains(*id)) {
        conn.execute(
            "UPDATE notifications SET state = 'done' WHERE id = ?1",
            [id],
        )
        .map_err(|e| e.to_string())?;
        resolved += 1;
    }
    Ok(resolved)
}

/// Upserts fetched items; returns how many were new. Existing rows keep their
/// read/done state — a sync must never resurrect what the user already triaged.
pub fn upsert(conn: &rusqlite::Connection, items: &[Fetched]) -> Result<usize, String> {
    let mut new_count = 0usize;
    for item in items {
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM notifications WHERE id = ?1",
                [&item.id],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !exists {
            new_count += 1;
        }
        let context_json = serde_json::to_string(&item.meta).map_err(|e| e.to_string())?;
        let (rel_kind, rel_score, rel_reason) = match &item.relevance {
            Some(r) => (Some(r.kind.clone()), Some(r.score), Some(r.reason.clone())),
            None => (None, None, None),
        };
        conn.execute(
            "INSERT INTO notifications (id, source, type, title, snippet, url, created_at, priority,
                                        context_json, relevance_kind, relevance_score, relevance_reason)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                snippet = excluded.snippet,
                url = excluded.url,
                created_at = excluded.created_at,
                priority = excluded.priority,
                context_json = excluded.context_json,
                relevance_kind = excluded.relevance_kind,
                relevance_score = excluded.relevance_score,
                relevance_reason = excluded.relevance_reason",
            rusqlite::params![
                item.id,
                item.source,
                item.ntype,
                item.title,
                item.snippet,
                item.url,
                item.created_at,
                item.priority,
                context_json,
                rel_kind,
                rel_score,
                rel_reason,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(new_count)
}

/// Inbox notification when a Claude agent run finishes (done/failed), so
/// results aren't missed if the Agents view isn't open. Also fires a native
/// notification; `waiting` runs get only the native ping (no inbox row).
#[tauri::command]
pub fn agent_notify(
    app: tauri::AppHandle,
    db: State<AppDb>,
    run_id: String,
    orig_id: String,
    title: String,
    detail: String,
    kind: String, // waiting | done | failed
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    let (native_title, priority) = match kind.as_str() {
        "waiting" => ("Agent waiting for you", 0.0),
        "failed" => ("Agent failed", 84.0),
        _ => ("Agent finished", 80.0),
    };
    let _ = app
        .notification()
        .builder()
        .title(native_title)
        .body(&title)
        .show();

    if kind == "waiting" {
        return Ok(());
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    let mut meta = HashMap::new();
    meta.insert("orig_id".into(), orig_id);
    meta.insert("outcome".into(), kind.clone());
    let item = Fetched {
        id: format!("agent:{run_id}"),
        source: "agent",
        ntype: "agent_done",
        title: format!(
            "{} — {}",
            if kind == "failed" {
                "Agent failed"
            } else {
                "Agent finished"
            },
            title
        ),
        snippet: detail,
        url: None,
        created_at: now,
        priority,
        meta,
        relevance: None,
    };
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    upsert(&conn, std::slice::from_ref(&item))?;
    Ok(())
}

/// Merges one key into a notification's meta (context_json) — used to link a
/// created Linear ticket back to its source Sentry/Slack item.
#[tauri::command]
pub fn notification_set_meta(
    db: State<AppDb>,
    id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let current: String = conn
        .query_row(
            "SELECT context_json FROM notifications WHERE id = ?1",
            [&id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut meta: HashMap<String, String> = serde_json::from_str(&current).unwrap_or_default();
    meta.insert(key, value);
    let json = serde_json::to_string(&meta).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE notifications SET context_json = ?1 WHERE id = ?2",
        rusqlite::params![json, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
