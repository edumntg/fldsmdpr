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

/// PATH augmented with the usual CLI locations, since GUI apps on macOS spawn
/// children with a minimal PATH. Prepended to the inherited env.
fn augmented_path() -> String {
    let mut dirs: Vec<String> = Vec::new();
    if let Some(home) = dirs_home() {
        dirs.push(home.join(".local/bin").display().to_string());
    }
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].map(String::from));
    if let Ok(existing) = std::env::var("PATH") {
        dirs.push(existing);
    }
    dirs.join(":")
}

/// Builds a claude Command by full path, inheriting the app's environment (so
/// its login/keychain access carries over) plus an augmented PATH.
fn claude_command(extra_args: &[&str]) -> Option<Command> {
    let bin = claude_bin()?;
    let mut cmd = Command::new(bin);
    cmd.args(extra_args).env("PATH", augmented_path());
    Some(cmd)
}

/// Returns true if the claude CLI reports the Slack MCP as connected.
pub fn claude_slack_ready() -> bool {
    let Some(cmd) = claude_command(&["mcp", "list"]) else {
        return false;
    };
    let Ok(out) = run_with_timeout(cmd, 30) else {
        return false;
    };
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
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
         {{\"items\":[{{\"channel\":\"\",\"from\":\"\",\"text\":\"\",\"ts\":\"\",\"permalink\":\"\",\"kind\":\"explicit\",\"reason\":\"\"}}],\"daySummary\":\"\",\"weekSummary\":\"\"}}\n\
         - items: last 24h only. \"kind\" is \"explicit\" for @mentions/DMs/thread replies, or \"implicit\" for inferred relevance (short justification in \"reason\"). \"text\" trimmed ~200 chars. \"ts\" = Slack message timestamp. Skip bots. Max 25 items.\n\
         - daySummary / weekSummary: 2-5 concise sentences each; you may use \"- \" bullet lines. If nothing notable, say so briefly.\n\
         If Slack is unavailable, return {{\"items\":[],\"daySummary\":\"\",\"weekSummary\":\"\"}}."
    )
}

/// Runs a command with a hard timeout (claude's JSON output is small, so a
/// single wait_with_output after exit won't deadlock on the pipe buffer).
fn run_with_timeout(mut cmd: Command, secs: u64) -> Result<std::process::Output, String> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't run claude: {e}"))?;
    let start = Instant::now();
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            return child.wait_with_output().map_err(|e| e.to_string());
        }
        if start.elapsed() > Duration::from_secs(secs) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "claude timed out after {secs}s (Slack analysis took too long)."
            ));
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

/// Runs the headless claude query and parses items + summaries.
pub fn fetch_via_claude(about_me: &str) -> Result<SlackAiResult, String> {
    let prompt = build_prompt(about_me);
    let cmd = claude_command(&[
        "-p",
        &prompt,
        "--output-format",
        "json",
        "--allowedTools",
        "mcp__claude_ai_Slack",
    ])
    .ok_or("The `claude` CLI wasn't found on this machine.")?;
    let out = run_with_timeout(cmd, 240)?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        // Surface the model's own error message (e.g. "Not logged in") if present.
        if let Some(msg) = serde_json::from_str::<Value>(stdout.trim())
            .ok()
            .and_then(|v| v["result"].as_str().map(str::to_string))
        {
            return Err(msg);
        }
        return Err(format!("claude failed: {}", err.trim()));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    // The CLI returns a JSON envelope; the model's answer is in `.result`.
    let envelope: Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Unexpected claude output: {e}"))?;
    let result_text = envelope["result"].as_str().unwrap_or("");
    let obj_str = extract_json_object(result_text)
        .ok_or("Claude didn't return a JSON object (Slack may be unavailable).")?;
    let obj: Value = serde_json::from_str(obj_str).map_err(|e| e.to_string())?;

    let day_summary = obj["daySummary"].as_str().unwrap_or("").to_string();
    let week_summary = obj["weekSummary"].as_str().unwrap_or("").to_string();
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
