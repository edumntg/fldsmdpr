//! Generalized "analysis round via headless claude + an MCP connector".
//!
//! Same proven mechanics as the Slack round (direct spawn, stdin null, output
//! to files, Sonnet model, bounded time windows). Used for sources whose org
//! blocks direct tokens (Notion) or that have no public token API (Granola).

use super::slack::{extract_json_object, result_envelope, run_claude_to_files};
use super::{Fetched, FetchedRelevance};
use serde_json::Value;
use std::collections::HashMap;

/// Runs one claude round scoped to a single MCP server and parses the JSON
/// object out of the model's answer.
fn run_round(allowed_tool: &str, prompt: &str, secs: u64) -> Result<Value, String> {
    let (raw, stderr, success) = run_claude_to_files(
        &[
            "-p",
            prompt,
            "--output-format",
            "json",
            "--allowedTools",
            allowed_tool,
            "--model",
            "claude-sonnet-5",
        ],
        secs,
    )?;
    if raw.trim().is_empty() {
        let head: String = stderr.chars().take(300).collect();
        return Err(if head.trim().is_empty() {
            format!("claude produced no output (exit success={success}).")
        } else {
            format!("claude failed: {}", head.trim())
        });
    }
    let envelope = result_envelope(&raw).ok_or("Unexpected claude output (no result envelope).")?;
    if envelope["is_error"].as_bool() == Some(true) {
        return Err(envelope["result"]
            .as_str()
            .unwrap_or("claude reported an error")
            .to_string());
    }
    let text = envelope["result"].as_str().unwrap_or("");
    let obj = extract_json_object(text).ok_or("No JSON object in the answer.")?;
    serde_json::from_str(obj).map_err(|e| e.to_string())
}

fn parse_when(v: &Value) -> i64 {
    v.as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp_millis())
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis())
}

fn iso_ms(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .unwrap_or_default()
}

/// Window instruction: incremental ("after your last analysis") when we have a
/// recent sync timestamp, else the full default window.
fn window_clause(since_ms: Option<i64>, full: &str) -> String {
    match since_ms {
        Some(t) => format!(
            "ONLY activity AFTER {} — you already analyzed everything before that; do NOT re-read older history",
            iso_ms(t)
        ),
        None => full.to_string(),
    }
}

/// Notion: pages/tasks assigned to me, comments mentioning me, docs awaiting my
/// input — incremental after `since_ms`, else last 7 days.
pub fn notion_round(about_me: &str, since_ms: Option<i64>) -> Result<Vec<Fetched>, String> {
    let profile = if about_me.trim().is_empty() {
        "(none)"
    } else {
        about_me.trim()
    };
    let window = window_clause(since_ms, "ONLY recent activity (last 7 days max)");
    let prompt = format!(
        "Using the Notion tools, inspect {window}:\n\
         1) pages or database tasks assigned to me; 2) comments that mention me; 3) docs shared with me that await my review or input.\n\
         My profile: {profile}\n\
         Respond with ONLY a JSON object: {{\"items\":[{{\"title\":\"\",\"text\":\"\",\"url\":\"\",\"when\":\"ISO-8601\",\"kind\":\"explicit\",\"reason\":\"\"}}]}}\n\
         - \"kind\": \"explicit\" for direct assignments/mentions, \"implicit\" for relevance you inferred (short \"reason\").\n\
         - \"text\": 1-2 sentence gist, ~200 chars. Max 15 items. If nothing or Notion unavailable: {{\"items\":[]}}."
    );
    let obj = run_round("mcp__claude_ai_Notion", &prompt, 300)?;

    let mut out = Vec::new();
    for it in obj["items"].as_array().cloned().unwrap_or_default() {
        let title = it["title"].as_str().unwrap_or("(untitled)").to_string();
        let url = it["url"].as_str().map(String::from);
        let kind = it["kind"].as_str().unwrap_or("explicit");
        let implicit = kind == "implicit";
        let id_key = url.clone().unwrap_or_else(|| title.clone());
        out.push(Fetched {
            id: format!("notion:{id_key}"),
            source: "notion",
            ntype: if implicit { "ai_inferred" } else { "mention" },
            title,
            snippet: it["text"].as_str().unwrap_or("").to_string(),
            url,
            created_at: parse_when(&it["when"]),
            priority: if implicit { 68.0 } else { 74.0 },
            meta: HashMap::new(),
            relevance: Some(FetchedRelevance {
                kind: kind.to_string(),
                score: if implicit { 0.75 } else { 1.0 },
                reason: it["reason"]
                    .as_str()
                    .unwrap_or("Assigned or mentioned")
                    .to_string(),
            }),
        });
    }
    Ok(out)
}

/// Granola: action items from my meetings — incremental after `since_ms`,
/// else the last 48 hours.
pub fn granola_round(since_ms: Option<i64>) -> Result<Vec<Fetched>, String> {
    let window = window_clause(since_ms, "ONLY my meetings from the LAST 48 HOURS");
    let prompt = format!(
        "Using the Granola tools, look at {window}.\n\
        Extract action items that are mine: commitments I made, questions directed at me, and decisions that require my action.\n\
        Respond with ONLY a JSON object: {{\"items\":[{{\"meeting\":\"\",\"text\":\"\",\"when\":\"ISO-8601\",\"url\":\"\"}}]}}\n\
        - \"text\": the action item in one sentence. Max 15 items. If none or Granola unavailable: {{\"items\":[]}}."
    );
    let obj = run_round("mcp__claude_ai_Granola", &prompt, 300)?;
    let items = obj["items"].as_array().cloned().unwrap_or_default();

    // All action items per meeting, so each notification can show its
    // siblings ("everything from this meeting") in the detail pane.
    let mut per_meeting: HashMap<String, Vec<String>> = HashMap::new();
    for it in &items {
        let meeting = it["meeting"].as_str().unwrap_or("Meeting").to_string();
        if let Some(text) = it["text"].as_str().filter(|t| !t.is_empty()) {
            per_meeting.entry(meeting).or_default().push(text.into());
        }
    }

    let mut out = Vec::new();
    for it in &items {
        let meeting = it["meeting"].as_str().unwrap_or("Meeting").to_string();
        let text = it["text"].as_str().unwrap_or("").to_string();
        if text.is_empty() {
            continue;
        }
        let key: String = text
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .take(24)
            .collect();
        let mut meta = HashMap::new();
        meta.insert("meeting".into(), meeting.clone());
        if let Some(all) = per_meeting.get(&meeting) {
            meta.insert(
                "meeting_items".into(),
                serde_json::to_string(all).unwrap_or_default(),
            );
        }
        out.push(Fetched {
            id: format!("granola:{meeting}:{key}"),
            source: "granola",
            ntype: "action_item",
            title: text.clone(),
            snippet: format!("From “{meeting}”"),
            url: it["url"]
                .as_str()
                .filter(|u| u.starts_with("http"))
                .map(String::from),
            created_at: parse_when(&it["when"]),
            priority: 76.0,
            meta,
            relevance: None,
        });
    }
    Ok(out)
}

/// Fetches (a condensed version of) one meeting's transcript via the Granola
/// MCP connector. Slow (~1 min) — the caller caches the result.
pub fn granola_transcript(meeting: &str) -> Result<String, String> {
    let safe = meeting.replace('"', "'");
    let prompt = format!(
        "Using the Granola tools, find my meeting titled \"{safe}\" (search my meetings from the last 14 days; pick the closest title match) and fetch its transcript.\n\
         Respond with ONLY a JSON object: {{\"transcript\":\"...\"}}.\n\
         - Keep speaker labels. If the transcript exceeds ~12000 characters, keep the parts with decisions, action items and discussions (mark cuts with […]).\n\
         - If the meeting or transcript can't be found: {{\"transcript\":\"\"}}."
    );
    let obj = run_round("mcp__claude_ai_Granola", &prompt, 360)?;
    Ok(obj["transcript"].as_str().unwrap_or("").to_string())
}
