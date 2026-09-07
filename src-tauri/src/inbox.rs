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
        .query_map([], |r| {
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
            let meta: Option<HashMap<String, String>> =
                serde_json::from_str(&r.get::<_, String>(12)?).ok();
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
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
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
