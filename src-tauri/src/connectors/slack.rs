use super::{Fetched, FetchedRelevance};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

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

/// Returns true if the claude CLI reports the Slack MCP as connected.
pub fn claude_slack_ready() -> bool {
    let Some(bin) = claude_bin() else {
        return false;
    };
    let Ok(out) = std::process::Command::new(bin)
        .args(["mcp", "list"])
        .output()
    else {
        return false;
    };
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .any(|l| l.to_lowercase().contains("slack") && l.contains("✔"))
}

fn build_prompt(about_me: &str) -> String {
    let profile = if about_me.trim().is_empty() {
        "(no profile provided)".to_string()
    } else {
        about_me.trim().to_string()
    };
    format!(
        "You have Slack access via MCP tools. Find items from the last 24 hours that need my attention:\n\
         1) messages that @-mention me; 2) DMs to me; 3) threads I'm in with new replies;\n\
         4) messages relevant to me even without an @-mention — about services I own, my projects, my name, or decisions affecting my team.\n\n\
         My profile: {profile}\n\n\
         Respond with ONLY a JSON array as the final content. Each item exactly:\n\
         {{\"channel\":\"\",\"from\":\"\",\"text\":\"\",\"ts\":\"\",\"permalink\":\"\",\"kind\":\"explicit\",\"reason\":\"\"}}\n\
         - \"kind\" is \"explicit\" for @mentions/DMs/thread replies, or \"implicit\" for relevance you inferred (put a short justification in \"reason\").\n\
         - \"text\": the message trimmed to ~200 chars. \"ts\": the Slack message timestamp.\n\
         Skip automated/bot messages. Max 25 items. If Slack is unavailable, return []."
    )
}

/// Runs the headless claude query and parses items into notifications.
pub fn fetch_via_claude(about_me: &str) -> Result<Vec<Fetched>, String> {
    let bin = claude_bin().ok_or("The `claude` CLI wasn't found on this machine.")?;
    let out = std::process::Command::new(&bin)
        .args([
            "-p",
            &build_prompt(about_me),
            "--output-format",
            "json",
            "--allowedTools",
            "mcp__claude_ai_Slack",
        ])
        .output()
        .map_err(|e| format!("Couldn't run claude: {e}"))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("claude failed: {}", err.trim()));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    // The CLI returns a JSON envelope; the model's answer is in `.result`.
    let envelope: Value = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Unexpected claude output: {e}"))?;
    let result_text = envelope["result"].as_str().unwrap_or("");
    let array_str = extract_json_array(result_text)
        .ok_or("Claude didn't return a JSON array (Slack may be unavailable).")?;
    let items: Vec<Value> = serde_json::from_str(array_str).map_err(|e| e.to_string())?;

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
    Ok(out_items)
}

/// Extracts the first balanced JSON array from text that may be wrapped in prose
/// or ```json fences (the org compliance layer can prepend a warning).
fn extract_json_array(s: &str) -> Option<&str> {
    let start = s.find('[')?;
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
        match c {
            '"' => in_str = true,
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&s[start..=i]);
                }
            }
            _ => {}
        }
    }
    None
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
