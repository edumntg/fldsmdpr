use super::{Fetched, FetchedRelevance};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

// ============================================================================
// Slack via headless `claude` + the official Slack MCP connector.
//
// The org blocks creating Slack apps and restricts session-token API access, so
// the robust path is to let Claude (which has an authenticated Slack MCP) fetch
// and *judge relevance* in one shot — giving explicit mentions AND AI-inferred
// relevance (the differentiator) for free. Slower (~1 min), so it runs on its
// own slower cadence, separate from the fast GitHub/Linear sync.
// ============================================================================

pub fn claude_bin() -> Option<PathBuf> {
    if let Ok(out) = std::process::Command::new("which").arg("claude").output() {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !p.is_empty() {
                return Some(PathBuf::from(p));
            }
        }
    }
    [
        dirs_home().map(|h| h.join(".local/bin/claude")),
        Some(PathBuf::from("/opt/homebrew/bin/claude")),
        Some(PathBuf::from("/usr/local/bin/claude")),
    ]
    .into_iter()
    .flatten()
    .find(|p| p.exists())
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Appends a diagnostic line to ~/Library/Logs/FLDSMDPR/slack-ai.log. Logs
/// mechanics only (timings, exit codes, error strings) — never message content.
fn ai_log(line: &str) {
    let Some(home) = dirs_home() else { return };
    let dir = home.join("Library/Logs/FLDSMDPR");
    let _ = std::fs::create_dir_all(&dir);
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let entry = format!("[{ts}] {line}\n");
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("slack-ai.log"))
    {
        let _ = f.write_all(entry.as_bytes());
    }
}

/// Runs claude (by full path) with **stdin closed** and **stdout/stderr
/// redirected to temp files**, with a hard timeout. Both details are load-
/// bearing, learned from real hangs when spawned from the GUI app:
///  - `claude -p` waits for EOF on a non-TTY stdin, so stdin must be null;
///  - piped stdout/stderr that nobody drains fill up (64KB) and deadlock the
///    child mid-run — real files have no such limit.
///
/// A shell wrapper (`zsh -ilc`) is also unusable: without a TTY it detaches the
/// job and returns immediately. Direct spawn is verified to authenticate fine
/// in the launchd (GUI app) context.
fn run_claude_to_files(args: &[&str], secs: u64) -> Result<(String, String, bool), String> {
    use std::fs;

    let bin = claude_bin().ok_or("The `claude` CLI wasn't found on this machine.")?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let base = std::env::temp_dir().join(format!("fldsmdpr-claude-{}-{nanos}", std::process::id()));
    let out_path = base.with_extension("out");
    let err_path = base.with_extension("err");
    let out_file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
    let err_file = fs::File::create(&err_path).map_err(|e| e.to_string())?;

    let mut child = Command::new(&bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(out_file))
        .stderr(Stdio::from(err_file))
        .spawn()
        .map_err(|e| format!("Couldn't run claude: {e}"))?;

    let start = Instant::now();
    let status = loop {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
            break st;
        }
        if start.elapsed() > Duration::from_secs(secs) {
            let _ = child.kill();
            let _ = child.wait();
            let err_head: String = fs::read_to_string(&err_path)
                .unwrap_or_default()
                .chars()
                .take(300)
                .collect();
            ai_log(&format!(
                "TIMEOUT after {secs}s; args[0..2]={:?}; stderr_head={err_head:?}",
                &args[..args.len().min(2)]
            ));
            let _ = fs::remove_file(&out_path);
            let _ = fs::remove_file(&err_path);
            return Err(format!("claude timed out after {secs}s"));
        }
        std::thread::sleep(Duration::from_millis(300));
    };

    let stdout = fs::read_to_string(&out_path).unwrap_or_default();
    let stderr = fs::read_to_string(&err_path).unwrap_or_default();
    let _ = fs::remove_file(&out_path);
    let _ = fs::remove_file(&err_path);
    ai_log(&format!(
        "claude {:?} finished in {}s; success={}; stdout={}B stderr={}B",
        &args[..args.len().min(2)],
        start.elapsed().as_secs(),
        status.success(),
        stdout.len(),
        stderr.len()
    ));
    Ok((stdout, stderr, status.success()))
}

/// Returns true if the claude CLI reports the Slack MCP as connected.
pub fn claude_slack_ready() -> bool {
    let Ok((stdout, _, _)) = run_claude_to_files(&["mcp", "list"], 60) else {
        return false;
    };
    stdout
        .lines()
        .any(|l| l.to_lowercase().contains("slack") && l.contains("✔"))
}

/// Result of a Slack analysis round: actionable items (last 24h) plus a day and
/// week summary.
pub struct SlackAiResult {
    pub items: Vec<Fetched>,
    pub day_summary: String,
    pub week_summary: String,
}

fn build_prompt(about_me: &str) -> String {
    let profile = if about_me.trim().is_empty() {
        "(no profile provided)".to_string()
    } else {
        about_me.trim().to_string()
    };
    format!(
        "You have Slack access via MCP tools. Do TWO things, inspecting ONLY recent messages (never older than 7 days):\n\n\
         1) LAST 24 HOURS — actionable items that need my attention: @-mentions of me, DMs to me, thread replies where I'm involved, and messages relevant to me even without an @-mention (about services I own, my projects, my name, or decisions affecting my team).\n\n\
         2) SUMMARIES — a concise summary of the LAST 24 HOURS (\"daySummary\") and of the LAST 7 DAYS MAX (\"weekSummary\") across the channels and DMs relevant to me: key themes, decisions made, and things awaiting my follow-up. Do NOT read messages older than 7 days.\n\n\
         My profile: {profile}\n\n\
         Respond with ONLY a JSON object as the final content:\n\
         {{\"items\":[{{\"channel\":\"\",\"from\":\"\",\"text\":\"\",\"ts\":\"\",\"permalink\":\"\",\"kind\":\"explicit\",\"reason\":\"\"}}],\
\"daySummary\":[{{\"text\":\"\",\"channel\":\"\",\"actionable\":false}}],\"weekSummary\":[{{\"text\":\"\",\"channel\":\"\",\"actionable\":false}}]}}\n\
         - items: last 24h only. \"kind\" is \"explicit\" for @mentions/DMs/thread replies, or \"implicit\" for inferred relevance (short justification in \"reason\"). \"text\" trimmed ~200 chars. \"ts\" = Slack message timestamp. Skip bots. Max 25 items.\n\
         - daySummary: 3-8 granular, self-contained bullet items covering the last 24h. weekSummary: 3-10 items covering the last 7 days max (themes, decisions, pending follow-ups). Each item: \"text\" (1-2 sentences), \"channel\" where it happened, and \"actionable\": true ONLY if it describes concrete work I could delegate to a coding agent (a bug, fix request, code task) — false for FYI/decisions/social.\n\
         If nothing notable, return one item saying so. If Slack is unavailable, return {{\"items\":[],\"daySummary\":[],\"weekSummary\":[]}}."
    )
}

/// claude's stdout can contain several concatenated JSON objects; the answer is
/// the one with `"type":"result"` (kept last if repeated).
fn result_envelope(raw: &str) -> Option<Value> {
    let mut envelope = None;
    for v in serde_json::Deserializer::from_str(raw.trim()).into_iter::<Value>() {
        match v {
            Ok(v) if v["type"] == "result" || v.get("result").is_some() => envelope = Some(v),
            Ok(_) => {}
            Err(_) => break,
        }
    }
    envelope
}

/// Runs the headless claude query and parses items + summaries.
pub fn fetch_via_claude(about_me: &str) -> Result<SlackAiResult, String> {
    let prompt = build_prompt(about_me);
    let (raw, stderr, success) = run_claude_to_files(
        &[
            "-p",
            &prompt,
            "--output-format",
            "json",
            "--allowedTools",
            "mcp__claude_ai_Slack",
        ],
        240,
    )?;

    if raw.trim().is_empty() {
        let head: String = stderr.chars().take(300).collect();
        return Err(if head.trim().is_empty() {
            format!("claude produced no output (exit success={success}).")
        } else {
            format!("claude failed: {}", head.trim())
        });
    }

    // The CLI returns a JSON envelope; the model's answer is in `.result`.
    let envelope = result_envelope(&raw).ok_or("Unexpected claude output (no result envelope).")?;
    // Surface claude's own error (e.g. "Not logged in · Please run /login").
    if envelope["is_error"].as_bool() == Some(true) {
        return Err(envelope["result"]
            .as_str()
            .unwrap_or("claude reported an error")
            .to_string());
    }
    let result_text = envelope["result"].as_str().unwrap_or("");
    let obj_str = extract_json_object(result_text)
        .ok_or("Claude didn't return a JSON object (Slack may be unavailable).")?;
    let obj: Value = serde_json::from_str(obj_str).map_err(|e| e.to_string())?;

    // Summaries are stored as JSON (array of granular items; older runs may have
    // produced a plain string — the frontend handles both).
    let day_summary = serde_json::to_string(&obj["daySummary"]).unwrap_or_default();
    let week_summary = serde_json::to_string(&obj["weekSummary"]).unwrap_or_default();
    let items = obj["items"].as_array().cloned().unwrap_or_default();

    let mut out_items = Vec::new();
    for it in &items {
        let ts = it["ts"].as_str().unwrap_or("");
        if ts.is_empty() {
            continue;
        }
        let created_ms = ts
            .split('.')
            .next()
            .and_then(|s| s.parse::<i64>().ok())
            .map(|s| s * 1000)
            .unwrap_or(0);

        let channel = it["channel"].as_str().unwrap_or("Slack").to_string();
        let from = it["from"].as_str().unwrap_or("Someone").to_string();
        let text = it["text"].as_str().unwrap_or("").to_string();
        let kind = it["kind"].as_str().unwrap_or("explicit");
        let reason = it["reason"].as_str().unwrap_or("").to_string();
        let implicit = kind == "implicit";

        let mut meta = HashMap::new();
        meta.insert("channel".into(), channel.clone());
        meta.insert("from".into(), from.clone());

        out_items.push(Fetched {
            id: format!("slack:{ts}"),
            source: "slack",
            ntype: if implicit { "ai_inferred" } else { "mention" },
            title: if implicit {
                format!("Relevant in {channel}")
            } else {
                format!("{from} · {channel}")
            },
            snippet: text,
            url: it["permalink"].as_str().map(String::from),
            created_at: created_ms,
            priority: if implicit { 78.0 } else { 82.0 },
            meta,
            relevance: Some(FetchedRelevance {
                kind: kind.to_string(),
                score: if implicit { 0.8 } else { 1.0 },
                reason: if reason.is_empty() {
                    "Directly addressed to you".into()
                } else {
                    reason
                },
            }),
        });
    }
    Ok(SlackAiResult {
        items: out_items,
        day_summary,
        week_summary,
    })
}

/// Extracts the first balanced JSON value starting at `open`/`close` bracket from
/// text that may be wrapped in prose or ```json fences (the org compliance layer
/// can prepend a warning).
fn extract_balanced(s: &str, open: char, close: char) -> Option<&str> {
    let start = s.find(open)?;
    let bytes = s.as_bytes();
    let mut depth = 0i32;
    let mut in_str = false;
    let mut escaped = false;
    for i in start..bytes.len() {
        let c = bytes[i] as char;
        if in_str {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_str = false;
            }
            continue;
        }
        if c == '"' {
            in_str = true;
        } else if c == open {
            depth += 1;
        } else if c == close {
            depth -= 1;
            if depth == 0 {
                return Some(&s[start..=i]);
            }
        }
    }
    None
}

fn extract_json_object(s: &str) -> Option<&str> {
    extract_balanced(s, '{', '}')
}

/// Slack credentials. `cookie` holds the `xoxd-…` value for session-token
/// (xoxc) auth — required because the org blocks creating Slack apps, so we
/// authenticate exactly like the web client (token + `d` cookie). For a proper
/// user token (xoxp) the cookie is None.
#[derive(Clone)]
pub struct SlackAuth {
    pub token: String,
    pub cookie: Option<String>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("fldsmdpr/0.1")
        .build()
        .map_err(|e| e.to_string())
}

async fn api(
    client: &reqwest::Client,
    auth: &SlackAuth,
    method: &str,
    params: &[(&str, &str)],
) -> Result<Value, String> {
    let mut req = client
        .get(format!("https://slack.com/api/{method}"))
        .bearer_auth(&auth.token)
        .query(params);
    if let Some(cookie) = &auth.cookie {
        req = req.header("Cookie", format!("d={cookie}"));
    }
    let res = req
        .send()
        .await
        .map_err(|e| format!("Slack request failed: {e}"))?;
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    if body["ok"].as_bool() != Some(true) {
        return Err(format!(
            "Slack {method} failed: {}",
            body["error"].as_str().unwrap_or("unknown error")
        ));
    }
    Ok(body)
}

/// Validates credentials via auth.test; returns "user @ team".
pub async fn validate(auth: &SlackAuth) -> Result<String, String> {
    let client = client()?;
    let body = api(&client, auth, "auth.test", &[]).await?;
    let user = body["user"].as_str().unwrap_or("connected");
    let team = body["team"].as_str().unwrap_or("");
    Ok(if team.is_empty() {
        user.to_string()
    } else {
        format!("{user} @ {team}")
    })
}

/// A channel the user belongs to, for the opt-in picker.
pub async fn list_channels(auth: &SlackAuth) -> Result<Vec<(String, String)>, String> {
    let client = client()?;
    let body = api(
        &client,
        auth,
        "users.conversations",
        &[
            ("types", "public_channel,private_channel,mpim,im"),
            ("exclude_archived", "true"),
            ("limit", "1000"),
        ],
    )
    .await?;

    let mut out = Vec::new();
    if let Some(chs) = body["channels"].as_array() {
        for c in chs {
            let Some(id) = c["id"].as_str() else { continue };
            let name = c["name"]
                .as_str()
                .map(|n| format!("#{n}"))
                .or_else(|| c["user"].as_str().map(|_| "DM".to_string()))
                .unwrap_or_else(|| id.to_string());
            out.push((id.to_string(), name));
        }
    }
    Ok(out)
}

/// Resolves a channel id to its "#name" (best effort — falls back to the id if
/// conversations.info is also enterprise-restricted).
pub async fn channel_name(auth: &SlackAuth, channel_id: &str) -> Result<String, String> {
    let client = client()?;
    let body = api(
        &client,
        auth,
        "conversations.info",
        &[("channel", channel_id)],
    )
    .await?;
    Ok(body["channel"]["name"]
        .as_str()
        .map(|n| format!("#{n}"))
        .unwrap_or_else(|| channel_id.to_string()))
}

/// Fetches recent messages from opted-in channels and emits a notification for
/// each one that explicitly @-mentions the authed user. Implicit / AI-inferred
/// detection is layered on next (triage pipeline).
pub async fn fetch(
    auth: &SlackAuth,
    channels: &[(String, String)],
) -> Result<Vec<Fetched>, String> {
    if channels.is_empty() {
        return Ok(Vec::new());
    }
    let client = client()?;

    let whoami = api(&client, auth, "auth.test", &[]).await?;
    let me = whoami["user_id"].as_str().unwrap_or_default().to_string();
    let team_url = whoami["url"]
        .as_str()
        .unwrap_or("https://slack.com/")
        .to_string();
    let mention_token = format!("<@{me}>");

    let mut user_names: HashMap<String, String> = HashMap::new();
    let mut out = Vec::new();

    for (channel_id, channel_name) in channels {
        // A channel we can't read shouldn't abort the whole sync.
        let history = match api(
            &client,
            auth,
            "conversations.history",
            &[("channel", channel_id), ("limit", "40")],
        )
        .await
        {
            Ok(v) => v,
            Err(_) => continue,
        };

        let Some(messages) = history["messages"].as_array() else {
            continue;
        };

        for msg in messages {
            let text = msg["text"].as_str().unwrap_or("");
            if me.is_empty() || !text.contains(&mention_token) {
                continue;
            }
            let ts = msg["ts"].as_str().unwrap_or_default();
            if ts.is_empty() {
                continue;
            }
            let author_id = msg["user"].as_str().unwrap_or("");
            let author = resolve_user(&client, auth, author_id, &mut user_names).await;

            let created_ms = ts
                .split('.')
                .next()
                .and_then(|s| s.parse::<i64>().ok())
                .map(|s| s * 1000)
                .unwrap_or(0);

            let permalink = format!("{team_url}archives/{channel_id}/p{}", ts.replace('.', ""));
            let snippet = humanize(text, &me, &mention_token);

            let mut meta = HashMap::new();
            meta.insert("channel".into(), channel_name.clone());
            if !author.is_empty() {
                meta.insert("from".into(), author.clone());
            }

            out.push(Fetched {
                id: format!("slack:{channel_id}:{ts}"),
                source: "slack",
                ntype: "mention",
                title: format!("{author} mentioned you in {channel_name}"),
                snippet,
                url: Some(permalink),
                created_at: created_ms,
                priority: 82.0,
                meta,
                relevance: None,
            });
        }
    }

    Ok(out)
}

async fn resolve_user(
    client: &reqwest::Client,
    auth: &SlackAuth,
    user_id: &str,
    cache: &mut HashMap<String, String>,
) -> String {
    if user_id.is_empty() {
        return String::new();
    }
    if let Some(name) = cache.get(user_id) {
        return name.clone();
    }
    let name = api(client, auth, "users.info", &[("user", user_id)])
        .await
        .ok()
        .and_then(|b| {
            b["user"]["profile"]["display_name"]
                .as_str()
                .filter(|s| !s.is_empty())
                .or(b["user"]["real_name"].as_str())
                .or(b["user"]["name"].as_str())
                .map(String::from)
        })
        .unwrap_or_else(|| "Someone".to_string());
    cache.insert(user_id.to_string(), name.clone());
    name
}

/// Trims to a readable snippet and replaces the self-mention token with "@you".
fn humanize(text: &str, _me: &str, mention_token: &str) -> String {
    let replaced = text.replace(mention_token, "@you");
    replaced
        .chars()
        .take(240)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
