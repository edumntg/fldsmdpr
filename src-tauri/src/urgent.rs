//! "Urgent / P0" picks for the Today view: the newest inbox items go to an
//! OpenRouter model (the user's "Jev") which returns the three to attack first.

use crate::AppDb;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

pub const SECRET_KEY: &str = "openrouter_api_key";
const MODEL_KV: &str = "jev_model";
// ponytail: fallback until the user pastes Jev's OpenRouter id in Settings.
const DEFAULT_MODEL: &str = "anthropic/claude-sonnet-4.5";
const CACHE_MS: i64 = 30 * 60_000;
const MAX_CANDIDATES: usize = 60;

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

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UrgentPick {
    pub id: String,
    pub reason: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct UrgentResult {
    pub picks: Vec<UrgentPick>,
    pub at: i64,
    pub window: String,
    pub model: String,
    /// How many inbox items the model saw.
    pub considered: usize,
}

struct Candidate {
    id: String,
    source: String,
    ntype: String,
    title: String,
    snippet: String,
    created_at: i64,
    context: String,
}

fn candidates(conn: &rusqlite::Connection, since: i64) -> Result<Vec<Candidate>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, source, type, title, snippet, created_at, COALESCE(context_json, '')
             FROM notifications
             WHERE state IN ('unread', 'read') AND source != 'gcal' AND created_at >= ?1
             ORDER BY created_at DESC
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![since, MAX_CANDIDATES as i64], |r| {
            Ok(Candidate {
                id: r.get(0)?,
                source: r.get(1)?,
                ntype: r.get(2)?,
                title: r.get(3)?,
                snippet: r.get(4)?,
                created_at: r.get(5)?,
                context: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn clip(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn build_prompt(cands: &[Candidate], window: &str) -> String {
    let now = chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let mut list = String::new();
    for c in cands {
        let age_h = (now_ms() - c.created_at).max(0) / 3_600_000;
        list.push_str(&format!(
            "- id: {}\n  source: {} ({})\n  age: {}h\n  title: {}\n  snippet: {}\n  context: {}\n",
            c.id,
            c.source,
            c.ntype,
            age_h,
            clip(&c.title, 160),
            clip(&c.snippet, 240),
            clip(&c.context, 200)
        ));
    }
    format!(
        "You are Jev, a chief-of-staff triaging an engineer's inbox. Below are their pending items from the last {window}.\n\
         Pick the THREE that must be attacked first today. Weigh: explicit urgency/priority, blocking others (PR reviews, questions directed at them), \
         production errors, deadlines, and age (older unanswered items get more urgent). Ignore FYI-only noise.\n\
         Respond with ONLY a JSON object: {{\"top\":[{{\"id\":\"<exact id>\",\"reason\":\"<max 12 words, why now>\"}}]}} — ranked, most urgent first, ids copied exactly.\n\n\
         Current local time: {now}\n\n{list}"
    )
}

async fn ask_openrouter(key: &str, model: &str, prompt: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("fldsmdpr/0.1")
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .bearer_auth(key)
        .header("X-Title", "FLDSMDPR")
        .json(&json!({
            "model": model,
            "temperature": 0.2,
            "messages": [{ "role": "user", "content": prompt }],
        }))
        .send()
        .await
        .map_err(|e| format!("OpenRouter request failed: {e}"))?;
    let status = res.status();
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let msg = body["error"]["message"]
            .as_str()
            .unwrap_or("request failed");
        return Err(format!("OpenRouter HTTP {status}: {msg}"));
    }
    body["choices"][0]["message"]["content"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "OpenRouter returned no content.".to_string())
}

/// `window`: "day" | "week". `force` skips the 30-minute cache.
#[tauri::command]
pub async fn urgent_pick(
    db: State<'_, AppDb>,
    window: String,
    force: bool,
) -> Result<UrgentResult, String> {
    let window = if window == "week" { "week" } else { "day" };
    let cache_key = format!("urgent:{window}");
    let now = now_ms();

    let (cands, model) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        if !force {
            if let Some(cached) = kv(&conn, &cache_key)
                .and_then(|s| serde_json::from_str::<UrgentResult>(&s).ok())
                .filter(|r| now - r.at < CACHE_MS)
            {
                return Ok(cached);
            }
        }
        let span = if window == "week" {
            7 * 86_400_000
        } else {
            86_400_000
        };
        (
            candidates(&conn, now - span)?,
            kv(&conn, MODEL_KV)
                .filter(|m| !m.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_MODEL.into()),
        )
    };

    let mut result = UrgentResult {
        picks: Vec::new(),
        at: now,
        window: window.into(),
        model: model.clone(),
        considered: cands.len(),
    };

    if cands.len() <= 3 {
        // Nothing to rank — don't spend a call.
        result.picks = cands
            .iter()
            .map(|c| UrgentPick {
                id: c.id.clone(),
                reason: "Only pending item in this window".into(),
            })
            .collect();
    } else {
        let key = crate::secrets::get(SECRET_KEY)
            .map_err(|e| e.to_string())?
            .filter(|k| !k.trim().is_empty())
            .ok_or("OpenRouter API key not set — add it in Settings → Urgent picks.")?;
        let text = ask_openrouter(&key, &model, &build_prompt(&cands, window)).await?;
        let obj = crate::connectors::slack::extract_json_object(&text)
            .ok_or("Jev answered without a JSON object.")?;
        let parsed: Value = serde_json::from_str(obj).map_err(|e| e.to_string())?;
        for it in parsed["top"].as_array().cloned().unwrap_or_default() {
            let id = it["id"].as_str().unwrap_or("");
            if cands.iter().any(|c| c.id == id) && !result.picks.iter().any(|p| p.id == id) {
                result.picks.push(UrgentPick {
                    id: id.into(),
                    reason: clip(it["reason"].as_str().unwrap_or(""), 120),
                });
            }
            if result.picks.len() == 3 {
                break;
            }
        }
    }

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    kv_set(
        &conn,
        &cache_key,
        &serde_json::to_string(&result).unwrap_or_default(),
    );
    Ok(result)
}
