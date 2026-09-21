//! AI triage with TypeSafe's Jev (a "System One" decision model) through
//! OpenRouter. Jev returns typed choices with calibrated probabilities instead
//! of prose, in ~100-500 ms, at $0.042 per million input tokens — cheap enough
//! to judge every notification on every sync.
//!
//! OpenRouter serves decision models on a dedicated endpoint
//! (`POST /api/alpha/decisions`), not `/chat/completions`. Same protocol as
//! TypeSafe's native API: `{model, state, questions}` → `{answers, usage}`.
//!
//! Everything Jev decides lands in the notification's meta under `jev_*`
//! keys, and `inbox::upsert` preserves those across syncs.

use crate::AppDb;
use rusqlite::OptionalExtension;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use tauri::State;

const URL: &str = "https://openrouter.ai/api/alpha/decisions";
const MODEL: &str = "typesafe/jev-1.13";
pub const KEY: &str = "token:openrouter";
const ENABLED_KV: &str = "jev:enabled";
const LAST_RUN_KV: &str = "jev:last_run";
const CONCURRENCY: usize = 8;
/// Below this the connector's own priority stays; Jev only overrides when sure.
const MIN_CONFIDENCE: f64 = 0.5;

fn kv_get(conn: &rusqlite::Connection, key: &str) -> Option<String> {
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

fn hash(s: &str) -> String {
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    format!("{:x}", h.finish())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("fldsmdpr/0.1")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

/// Shared HTTP client for connectors that judge inline (Slack fast path).
pub fn client_for_connectors() -> Result<reqwest::Client, String> {
    client()
}

/// One decisions request: answers every question against the same state.
pub async fn decide(
    client: &reqwest::Client,
    key: &str,
    state: Value,
    questions: Value,
) -> Result<Value, String> {
    let res = client
        .post(URL)
        .bearer_auth(key)
        .header("HTTP-Referer", "https://github.com/edumntg/fldsmdpr")
        .header("X-Title", "FLDSMDPR")
        .json(&json!({ "model": MODEL, "state": state, "questions": questions }))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    let status = res.status();
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let msg = body["error"]["message"]
            .as_str()
            .or(body["error"].as_str())
            .unwrap_or("request rejected");
        return Err(format!("OpenRouter {status}: {msg}"));
    }
    body.get("answers")
        .cloned()
        .ok_or_else(|| "OpenRouter returned no answers".to_string())
}

/// Who the user is, for every model that judges relevance (Jev triage, Slack
/// fast path, Notion/Slack claude rounds). Built from the structured profile
/// fields in Settings → About you plus the free-text notes.
pub fn profile_text(conn: &rusqlite::Connection) -> String {
    let mut parts = Vec::new();
    if let Some(v) = kv_get(conn, "profile:name").filter(|v| !v.trim().is_empty()) {
        parts.push(format!("Name: {}.", v.trim()));
    }
    if let Some(v) = kv_get(conn, "profile:email").filter(|v| !v.trim().is_empty()) {
        parts.push(format!("Email: {}.", v.trim()));
    }
    if let Some(v) = kv_get(conn, "profile:handles").filter(|v| !v.trim().is_empty()) {
        parts.push(format!(
            "Handles and aliases (GitHub, Slack, Linear, email): {}.",
            v.trim()
        ));
    }
    if let Some(v) = kv_get(conn, "profile:role").filter(|v| !v.trim().is_empty()) {
        parts.push(format!("Role and team: {}.", v.trim()));
    }
    if let Some(v) = kv_get(conn, "about_me").filter(|v| !v.trim().is_empty()) {
        parts.push(v.trim().to_string());
    }
    parts.join(" ")
}

/// Key present + not disabled → Jev runs inside every sync.
pub fn ready(conn: &rusqlite::Connection) -> Option<String> {
    if kv_get(conn, ENABLED_KV).as_deref() == Some("0") {
        return None;
    }
    crate::secrets::get(KEY).ok().flatten()
}

// ---- per-notification triage ----

struct Row {
    id: String,
    source: String,
    ntype: String,
    title: String,
    snippet: String,
    meta: Value,
}

fn load_rows(conn: &rusqlite::Connection, where_sql: &str) -> Result<Vec<Row>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, source, type, title, snippet, context_json FROM notifications WHERE {where_sql}"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Row {
                id: r.get(0)?,
                source: r.get(1)?,
                ntype: r.get(2)?,
                title: r.get(3)?,
                snippet: r.get(4)?,
                meta: serde_json::from_str(&r.get::<_, String>(5)?).unwrap_or(json!({})),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn trim(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Compact, relevant-only state — Jev's accuracy degrades with noise.
fn item_state(r: &Row, about_me: &str) -> Value {
    let m = &r.meta;
    let mut st = json!({
        "source": r.source,
        "kind": r.ntype,
        "title": trim(&r.title, 300),
        "body": trim(&r.snippet, 1200),
    });
    for k in [
        "repo", "project", "state", "priority", "ci", "level", "count", "is_pr", "author", "team",
        "channel", "from",
    ] {
        if let Some(v) = m.get(k).and_then(|v| v.as_str()) {
            st[k] = Value::String(trim(v, 120));
        }
    }
    if !about_me.trim().is_empty() {
        st["about_the_user"] = Value::String(trim(about_me, 900));
    }
    st
}

fn triage_questions() -> Value {
    json!({
        "urgency": {
            "type": "choice",
            "instructions": "How soon does the user need to deal with this item?",
            "criteria": {
                "urgent": "Production is affected, something is blocked, or it explicitly says urgent/ASAP/blocking.",
                "today": "Someone is waiting on the user (a review request, a direct ask, a failing CI on their PR, a meeting today).",
                "this_week": "Real work assigned to the user with no immediate pressure.",
                "fyi": "Informational only: an update, a merged/closed item, a low-severity error, nothing to do."
            }
        },
        "needs_action": {
            "type": "noul",
            "instructions": "The user personally has to do something about this item (review, fix, reply, decide, attend).",
            "criteria": {
                "true": "A concrete action by the user is requested or clearly required.",
                "false": "Nothing is required from the user; it is an update or someone else's work."
            }
        },
        "attack_now": {
            "type": "score",
            "instructions": "How strongly should the user stop what they are doing and handle this item right now?",
            "criteria": [
                "Can wait days, or needs nothing from the user.",
                "Should be handled this week.",
                "Should be handled today.",
                "Should be handled within the hour.",
                "Drop everything: production is down or people are blocked on the user."
            ]
        },
        "action": {
            "type": "choice",
            "instructions": "If a coding agent were started from this item, what should it do?",
            "criteria": {
                "review_code": "Review a pull request or code change.",
                "fix_bug": "Fix a failing test, CI failure, error, exception, or reported bug.",
                "investigate": "Look into a question, incident, or unclear behavior before acting.",
                "reply": "Write a response or update for a person.",
                "implement": "Build a feature or complete a task described in a ticket.",
                "none": "No agent work applies (event, FYI, finished item)."
            }
        }
    })
}

fn urgency_priority(u: &str) -> f64 {
    match u {
        "urgent" => 95.0,
        "today" => 80.0,
        "this_week" => 60.0,
        _ => 40.0,
    }
}

/// Meta patch + optional new priority derived from one triage answer set.
fn apply_triage(answers: &Value, content_hash: &str) -> (Value, Option<f64>) {
    let urgency = answers["urgency"]["choice"].as_str().unwrap_or("");
    let conf = answers["urgency"]["confidence"].as_f64().unwrap_or(0.0);
    let needs = answers["needs_action"]["noul"].as_f64().unwrap_or(0.5);
    let action = answers["action"]["choice"].as_str().unwrap_or("none");
    // 0–4 "attack now" score; the Today view's P0 card ranks by it.
    let attack = answers["attack_now"]["score"].as_f64().unwrap_or(0.0);
    let mut patch = json!({
        "jev_hash": content_hash,
        "jev_urgency": urgency,
        "jev_confidence": format!("{conf:.2}"),
        "jev_needs_action": format!("{needs:.2}"),
        "jev_action": action,
        "jev_attack": format!("{attack:.2}"),
    });
    let priority = if conf >= MIN_CONFIDENCE && !urgency.is_empty() {
        // Urgency sets the band; "needs my action" nudges within it (±8).
        let p = urgency_priority(urgency) + (needs - 0.5) * 16.0;
        patch["jev_priority"] = Value::String(format!("{p:.0}"));
        Some(p)
    } else {
        patch["jev_priority"] = Value::Null; // json_patch: null deletes the key
        None
    };
    (patch, priority)
}

/// Judge every open notification whose content changed since Jev last saw it.
async fn triage(db: &AppDb, key: &str) -> Result<usize, String> {
    let (rows, about_me) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        (load_rows(&conn, "state != 'done'")?, profile_text(&conn))
    };
    let pending: Vec<(Row, String)> = rows
        .into_iter()
        .filter_map(|r| {
            // "v2": question set changed (attack_now added) → re-judge once.
            let h = hash(&format!("{}\n{}\nv2", r.title, r.snippet));
            (r.meta["jev_hash"].as_str() != Some(h.as_str())).then_some((r, h))
        })
        .collect();
    if pending.is_empty() {
        return Ok(0);
    }

    let client = client()?;
    let questions = triage_questions();
    let mut judged = 0usize;
    // ponytail: chunked fan-out (8 at a time); a work-stealing pool if syncs feel slow
    for chunk in pending.chunks(CONCURRENCY) {
        let handles: Vec<_> = chunk
            .iter()
            .map(|(r, h)| {
                let client = client.clone();
                let key = key.to_string();
                let state = item_state(r, &about_me);
                let questions = questions.clone();
                let id = r.id.clone();
                let h = h.clone();
                tauri::async_runtime::spawn(async move {
                    decide(&client, &key, state, questions)
                        .await
                        .map(|a| (id, apply_triage(&a, &h)))
                })
            })
            .collect();
        let mut results = Vec::new();
        for hnd in handles {
            match hnd.await.map_err(|e| e.to_string())? {
                Ok(r) => results.push(r),
                Err(e) => return Err(e), // auth/quota errors: stop, don't spam
            }
        }
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        for (id, (patch, priority)) in results {
            conn.execute(
                "UPDATE notifications
                 SET context_json = json_patch(context_json, ?2),
                     priority = COALESCE(?3, priority)
                 WHERE id = ?1",
                rusqlite::params![id, patch.to_string(), priority],
            )
            .map_err(|e| e.to_string())?;
            judged += 1;
        }
    }
    Ok(judged)
}

// ---- Sentry error ↔ PR/ticket linking ----

fn candidates<'a>(err: &Row, rows: &'a [Row]) -> Vec<&'a Row> {
    let project = err.meta["project"].as_str().unwrap_or("");
    let mut same_repo: Vec<&Row> = rows
        .iter()
        .filter(|r| {
            matches!(r.source.as_str(), "github" | "linear")
                && !project.is_empty()
                && r.meta["repo"].as_str() == Some(project)
        })
        .collect();
    if same_repo.is_empty() {
        // No repo match: open PRs and in-flight tickets, newest first (the
        // SELECT already orders by created_at DESC).
        same_repo = rows
            .iter()
            .filter(|r| {
                (r.source == "github" && r.meta["is_pr"].as_str() != Some("false"))
                    || (r.source == "linear" && r.meta["state_type"].as_str() == Some("started"))
            })
            .collect();
    }
    same_repo.truncate(12);
    same_repo
}

async fn link_errors(db: &AppDb, key: &str) -> Result<usize, String> {
    let rows = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        load_rows(&conn, "state != 'done' ORDER BY created_at DESC")?
    };
    let errors: Vec<&Row> = rows.iter().filter(|r| r.source == "sentry").collect();
    if errors.is_empty() {
        return Ok(0);
    }
    let client = client()?;
    let question = json!({
        "related": {
            "type": "noul",
            "instructions": "The candidate pull request or ticket is about the same defect as the error: it fixes it, introduced it, or tracks it.",
            "criteria": {
                "true": "Same failing code path, function, endpoint, or symptom is named or clearly implied in both.",
                "false": "Only shares the repository or general area; different symptom or component."
            }
        }
    });

    let mut linked = 0usize;
    for err in errors {
        let cands = candidates(err, &rows);
        let set_hash = hash(
            &cands
                .iter()
                .map(|c| c.id.as_str())
                .collect::<Vec<_>>()
                .join("|"),
        );
        if err.meta["jev_related_hash"].as_str() == Some(set_hash.as_str()) {
            continue;
        }
        let err_state = json!({
            "title": trim(&err.title, 300),
            "details": trim(&err.snippet, 600),
            "culprit": err.meta["culprit"].as_str().unwrap_or(""),
            "project": err.meta["project"].as_str().unwrap_or(""),
        });
        let mut related: Vec<Value> = Vec::new();
        for chunk in cands.chunks(CONCURRENCY) {
            let handles: Vec<_> = chunk
                .iter()
                .map(|c| {
                    let client = client.clone();
                    let key = key.to_string();
                    let q = question.clone();
                    let state = json!({
                        "error": err_state,
                        "candidate": {
                            "source": c.source,
                            "title": trim(&c.title, 300),
                            "body": trim(&c.snippet, 600),
                            "repo": c.meta["repo"].as_str().unwrap_or(""),
                            "reference": c.meta["number"].as_str().or(c.meta["key"].as_str()).unwrap_or(""),
                        }
                    });
                    let (id, title) = (c.id.clone(), c.title.clone());
                    tauri::async_runtime::spawn(async move {
                        decide(&client, &key, state, q)
                            .await
                            .map(|a| (id, title, a["related"]["noul"].as_f64().unwrap_or(0.0)))
                    })
                })
                .collect();
            for hnd in handles {
                let (id, title, p) = hnd.await.map_err(|e| e.to_string())??;
                if p >= 0.6 {
                    related.push(
                        json!({ "id": id, "title": trim(&title, 120), "p": format!("{p:.2}") }),
                    );
                }
            }
        }
        related.sort_by(|a, b| b["p"].as_str().cmp(&a["p"].as_str()));
        let patch = json!({
            "jev_related_hash": set_hash,
            "jev_related": serde_json::to_string(&related).unwrap_or_default(),
        });
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE notifications SET context_json = json_patch(context_json, ?2) WHERE id = ?1",
            rusqlite::params![err.id, patch.to_string()],
        )
        .map_err(|e| e.to_string())?;
        linked += related.len();
    }
    Ok(linked)
}

/// Full pass (triage + error linking). Called at the end of `run_sync` and by
/// the "Analyze now" button. Returns how many notifications were judged.
pub async fn run(db: &AppDb, key: &str) -> Result<usize, String> {
    let judged = triage(db, key).await?;
    let _ = link_errors(db, key).await?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    kv_set(&conn, LAST_RUN_KV, &now_ms().to_string());
    Ok(judged)
}

// ---- commands ----

#[derive(serde::Deserialize)]
pub struct Sample {
    pub source: String,
    pub title: String,
    pub body: String,
}

#[derive(Serialize)]
pub struct Verdict {
    pub urgency: String,
    pub confidence: f64,
    pub needs_action: f64,
    pub action: String,
}

/// Settings playground: judge a few canned items with the real triage
/// questions so the user can see what the triage does. Nothing is stored.
#[tauri::command]
pub async fn jev_judge_samples(
    db: State<'_, AppDb>,
    items: Vec<Sample>,
) -> Result<Vec<Verdict>, String> {
    let (key, about_me) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        (
            ready(&conn).ok_or("Jev isn't connected")?,
            profile_text(&conn),
        )
    };
    let client = client()?;
    let questions = triage_questions();
    let mut out = Vec::with_capacity(items.len());
    for it in items.iter().take(6) {
        let row = Row {
            id: String::new(),
            source: it.source.clone(),
            ntype: "sample".into(),
            title: it.title.clone(),
            snippet: it.body.clone(),
            meta: json!({}),
        };
        let a = decide(
            &client,
            &key,
            item_state(&row, &about_me),
            questions.clone(),
        )
        .await?;
        out.push(Verdict {
            urgency: a["urgency"]["choice"].as_str().unwrap_or("fyi").to_string(),
            confidence: a["urgency"]["confidence"].as_f64().unwrap_or(0.0),
            needs_action: a["needs_action"]["noul"].as_f64().unwrap_or(0.0),
            action: a["action"]["choice"].as_str().unwrap_or("none").to_string(),
        });
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct JevStatus {
    pub connected: bool,
    pub enabled: bool,
    pub last_run: Option<i64>,
    pub judged: i64,
}

#[tauri::command]
pub fn jev_status(db: State<AppDb>) -> Result<JevStatus, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let judged: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM notifications WHERE json_extract(context_json, '$.jev_hash') IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(JevStatus {
        connected: crate::secrets::get(KEY).ok().flatten().is_some(),
        enabled: kv_get(&conn, ENABLED_KV).as_deref() != Some("0"),
        last_run: kv_get(&conn, LAST_RUN_KV).and_then(|s| s.parse().ok()),
        judged,
    })
}

/// Validates the key with one tiny real decision, then stores it in the keychain.
#[tauri::command]
pub async fn jev_connect(key: String) -> Result<(), String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("Paste your OpenRouter API key".into());
    }
    let answers = decide(
        &client()?,
        &key,
        json!("ping"),
        json!({ "ok": { "type": "noul", "instructions": "The state is the word ping." } }),
    )
    .await?;
    if answers.get("ok").is_none() {
        return Err("Unexpected response from OpenRouter".into());
    }
    crate::secrets::set(KEY, &key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn jev_disconnect() -> Result<(), String> {
    crate::secrets::delete(KEY).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn jev_set_enabled(db: State<AppDb>, enabled: bool) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    kv_set(&conn, ENABLED_KV, if enabled { "1" } else { "0" });
    Ok(())
}

/// "Analyze now": judge everything pending, regardless of the sync schedule.
#[tauri::command]
pub async fn jev_run(db: State<'_, AppDb>) -> Result<usize, String> {
    let key = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        ready(&conn).ok_or("Jev isn't connected")?
    };
    run(&db, &key).await
}

/// Judge the tail of an agent terminal: did the run finish, stall, or fail?
/// Returns `completed | needs_input | failed | in_progress`, or None when Jev
/// isn't configured or isn't confident enough to override the hook status.
#[tauri::command]
pub async fn jev_agent_outcome(
    db: State<'_, AppDb>,
    text: String,
) -> Result<Option<String>, String> {
    let key = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        match ready(&conn) {
            Some(k) => k,
            None => return Ok(None),
        }
    };
    let tail: String = text
        .chars()
        .rev()
        .take(3000)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let answers = decide(
        &client()?,
        &key,
        json!({ "terminal_tail": tail }),
        json!({
            "outcome": {
                "type": "choice",
                "instructions": "This is the end of a coding assistant's terminal session. What state is it in?",
                "criteria": {
                    "completed": "The assistant states the task is finished and summarizes what it did or changed.",
                    "needs_input": "The assistant asks the user a question, or waits for permission or a decision.",
                    "failed": "The assistant says it could not complete the task, hit an error it did not resolve, or gave up.",
                    "in_progress": "The assistant is still working: running tools, mid-explanation, no conclusion yet."
                }
            }
        }),
    )
    .await?;
    let conf = answers["outcome"]["confidence"].as_f64().unwrap_or(0.0);
    Ok(answers["outcome"]["choice"]
        .as_str()
        .filter(|_| conf >= 0.55)
        .map(String::from))
}
