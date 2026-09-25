//! "Ask" section: free-form questions with the app's data as context (recent
//! notifications, agent runs, sync state). One OpenRouter chat call on a fast
//! Gemini Flash, reusing the OpenRouter key from Jev — no `claude` CLI spawn.

use crate::AppDb;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

const URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const MODEL: &str = "google/gemini-3.8-flash";

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

fn build_messages(context: &str, history: &[ChatTurn], question: &str) -> Vec<Value> {
    let now = chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let system = format!(
        "You are the assistant inside FLDSMDPR, the user's personal developer dispatcher app. \
         Below is the app's current data. Answer the user's question using ONLY this data. \
         Answer in the language the user asks in, in concise markdown (bullet lists where natural, reference items by their title and source, mention times as relative when helpful). \
         If the data can't answer the question, say what's missing.\n\
         When you point to specific notifications (tickets, PRs, issues, errors, messages, meetings), \
         reference each one as [[<id>]] alone on its own line, using the exact `id` from the data — the app renders those lines as item cards \
         with title, source and status, so don't repeat the title next to the marker; add at most a short comment line before or after.\n\n\
         Current local time: {now}\n\n\
         ===== APP DATA =====\n{context}\n===== END APP DATA ====="
    );
    let mut messages = vec![json!({ "role": "system", "content": system })];
    for t in history.iter().rev().take(8).rev() {
        let role = if t.role == "assistant" {
            "assistant"
        } else {
            "user"
        };
        let content: String = t.content.chars().take(1500).collect();
        messages.push(json!({ "role": role, "content": content }));
    }
    messages.push(json!({ "role": "user", "content": question }));
    messages
}

#[tauri::command]
pub async fn ask_ai(
    db: State<'_, AppDb>,
    question: String,
    history: Vec<ChatTurn>,
) -> Result<String, String> {
    let key = crate::secrets::get(crate::jev::KEY)
        .map_err(|e| e.to_string())?
        .ok_or("No OpenRouter API key. Add one in Settings → Intelligence.")?;
    let context = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        build_context(&conn)?
    };

    let res = reqwest::Client::builder()
        .user_agent("fldsmdpr/0.1")
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?
        .post(URL)
        .bearer_auth(&key)
        .header("HTTP-Referer", "https://github.com/edumntg/fldsmdpr")
        .header("X-Title", "FLDSMDPR")
        .json(&json!({ "model": MODEL, "messages": build_messages(&context, &history, &question) }))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    let status = res.status();
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let msg = body["error"]["message"]
            .as_str()
            .unwrap_or("request rejected");
        return Err(format!("OpenRouter {status}: {msg}"));
    }
    body["choices"][0]["message"]["content"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "OpenRouter returned no answer".to_string())
}
