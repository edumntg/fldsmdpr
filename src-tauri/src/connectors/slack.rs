use super::Fetched;
use serde_json::Value;
use std::collections::HashMap;

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
