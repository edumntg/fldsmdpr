//! "Ask" section: free-form questions to claude with the app's data as
//! context (recent notifications, agent runs, sync state). Pure Q&A over the
//! local DB — no MCP tools, so rounds are fast (~10-30 s on Sonnet).

use crate::connectors::slack::{result_envelope, run_claude_to_files};
use crate::AppDb;
use serde::Deserialize;
use tauri::State;

#[derive(Deserialize)]
pub struct ChatTurn {
    pub role: String, // "user" | "assistant"
    pub content: String,
}

/// Meta keys worth exposing to the model (short, high-signal).
const META_KEYS: &[&str] = &[
    "repo",
    "number",
    "project",
    "channel",
    "meeting",
    "state",
    "team",
    "priority",
    "from",
    "linked_ticket",
    "level",
    "time",
];

fn iso(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .unwrap_or_default()
}

fn build_context(conn: &rusqlite::Connection) -> Result<String, String> {
    let mut lines = Vec::new();

    let mut stmt = conn
        .prepare(
            "SELECT id, source, type, state, title, snippet, created_at, priority, context_json
             FROM notifications ORDER BY created_at DESC LIMIT 250",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, f64>(7)?,
                r.get::<_, String>(8)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows.flatten() {
        let (id, source, ntype, state, title, snippet, created_at, priority, ctx) = row;
        let mut obj = serde_json::json!({
            "id": id,
            "source": source,
            "type": ntype,
            "state": state,
            "title": title.chars().take(160).collect::<String>(),
            "snippet": snippet.chars().take(200).collect::<String>(),
            "at": iso(created_at),
            "prio": priority as i64,
        });
        if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&ctx) {
            for k in META_KEYS {
                if let Some(v) = meta.get(*k).and_then(|v| v.as_str()) {
                    obj[*k] = serde_json::json!(v.chars().take(80).collect::<String>());
                }
            }
        }
        lines.push(obj.to_string());
    }
    let notifications = lines.join("\n");

    // Recent agent runs.
    let mut stmt = conn
        .prepare(
            "SELECT mode, status, title, source, label, started_at, ended_at
             FROM agent_sessions ORDER BY started_at DESC LIMIT 20",
        )
        .map_err(|e| e.to_string())?;
    let agents: Vec<String> = stmt
        .query_map([], |r| {
            Ok(format!(
                "{{\"runner\":\"{}\",\"status\":\"{}\",\"title\":{},\"source\":\"{}\",\"label\":\"{}\",\"started\":\"{}\",\"ended\":\"{}\"}}",
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                serde_json::json!(r.get::<_, String>(2)?.chars().take(120).collect::<String>()),
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                iso(r.get::<_, i64>(5)?),
                r.get::<_, Option<i64>>(6)?.map(iso).unwrap_or_default(),
            ))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();

    // Sync freshness per source.
    let mut stmt = conn
        .prepare(
            "SELECT key, value FROM kv WHERE key LIKE 'last_sync%' OR key LIKE '%ai_last_sync'",
        )
        .map_err(|e| e.to_string())?;
    let syncs: Vec<String> = stmt
        .query_map([], |r| {
            Ok(format!(
                "{}={}",
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?
                    .parse::<i64>()
                    .map(iso)
                    .unwrap_or_default()
            ))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();

    Ok(format!(
        "NOTIFICATIONS (newest first, one JSON per line — states: unread/read = pending, done = completed/archived, snoozed = deferred):\n{notifications}\n\nAGENT RUNS (latest 20):\n{}\n\nLAST SYNC TIMES:\n{}",
        agents.join("\n"),
        syncs.join(", ")
    ))
}

fn build_prompt(context: &str, history: &[ChatTurn], question: &str) -> String {
    let now = chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let mut convo = String::new();
    for t in history.iter().rev().take(8).rev() {
        let role = if t.role == "assistant" { "You" } else { "User" };
        convo.push_str(&format!(
            "{role}: {}\n",
            t.content.chars().take(1500).collect::<String>()
        ));
    }
    format!(
        "You are the assistant inside FLDSMDPR, the user's personal developer dispatcher app. \
         Below is the app's current data. Answer the user's question using ONLY this data — do not use any tools, do not browse, do not run commands. \
         Answer in the language the user asks in, in concise markdown (bullet lists where natural, reference items by their title and source, mention times as relative when helpful). \
         If the data can't answer the question, say what's missing.\n\n\
         Current local time: {now}\n\n\
         ===== APP DATA =====\n{context}\n===== END APP DATA =====\n\n\
         {}{}Question: {question}",
        if convo.is_empty() { "" } else { "Previous conversation:\n" },
        convo
    )
}

#[tauri::command]
pub async fn ask_claude(
    db: State<'_, AppDb>,
    question: String,
    history: Vec<ChatTurn>,
) -> Result<String, String> {
    let context = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        build_context(&conn)?
    };
    let prompt = build_prompt(&context, &history, &question);

    tauri::async_runtime::spawn_blocking(move || {
        let (raw, stderr, success) = run_claude_to_files(
            &[
                "-p",
                &prompt,
                "--output-format",
                "json",
                // No tools: pure summarization over the provided context.
                "--allowedTools",
                "",
                "--model",
                "claude-sonnet-5",
            ],
            180,
        )?;
        if raw.trim().is_empty() {
            let head: String = stderr.chars().take(300).collect();
            return Err(if head.trim().is_empty() {
                format!("claude produced no output (exit success={success}).")
            } else {
                format!("claude failed: {}", head.trim())
            });
        }
        let envelope =
            result_envelope(&raw).ok_or("Unexpected claude output (no result envelope).")?;
        if envelope["is_error"].as_bool() == Some(true) {
            return Err(envelope["result"]
                .as_str()
                .unwrap_or("claude reported an error")
                .to_string());
        }
        Ok(envelope["result"].as_str().unwrap_or("").to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
