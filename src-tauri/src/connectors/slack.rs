use super::{Fetched, FetchedRelevance};
use crate::claude_cli::{extract_json_object, result_envelope, run_claude_to_files};
use serde_json::Value;
use std::collections::HashMap;

// ============================================================================
// Slack via headless `claude` + the official Slack MCP connector.
//
// The org blocks creating Slack apps and restricts session-token API access, so
// the robust path is to let Claude (which has an authenticated Slack MCP) fetch
// and *judge relevance* in one shot — giving explicit mentions AND AI-inferred
// relevance (the differentiator) for free. Slower (~1 min), so it runs on its
// own slower cadence, separate from the fast GitHub/Linear sync.
// ============================================================================

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

/// State for incremental rounds: only read messages after `since_ms` and merge
/// them into the previous summaries instead of re-reading the whole window.
pub struct SlackIncremental {
    pub since_ms: i64,
    pub prev_day: String,
    pub prev_week: String,
}

fn build_prompt(about_me: &str, incr: Option<&SlackIncremental>) -> String {
    let profile = if about_me.trim().is_empty() {
        "(no profile provided)".to_string()
    } else {
        about_me.trim().to_string()
    };
    let incremental = incr
        .map(|i| {
            let iso = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(i.since_ms)
                .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
                .unwrap_or_default();
            format!(
                "\n\nINCREMENTAL MODE — you already analyzed everything before {iso}. \
                 Read ONLY messages posted AFTER {iso}; do NOT re-read older history (this is what makes the round fast). \
                 \"items\" and \"tasks\": only from those new messages. \
                 For the summaries, MERGE the new messages into your previous ones below and return the FULL updated arrays: \
                 keep still-relevant entries, update entries the new messages change, add new entries, and drop entries older than each window (daySummary = last 24h, weekSummary = last 7 days). \
                 If there are no new messages, return empty items/tasks and the previous summaries pruned to their windows.\n\
                 Previous daySummary: {}\nPrevious weekSummary: {}",
                if i.prev_day.is_empty() { "[]" } else { &i.prev_day },
                if i.prev_week.is_empty() { "[]" } else { &i.prev_week },
            )
        })
        .unwrap_or_default();
    format!(
        "You have Slack access via MCP tools. Do THREE things, inspecting ONLY recent messages (never older than 7 days):\n\n\
         1) LAST 24 HOURS — actionable items that need my attention: @-mentions of me, DMs to me, thread replies where I'm involved, and messages relevant to me even without an @-mention (about services I own, my projects, my name, or decisions affecting my team).\n\n\
         2) SUMMARIES — a concise summary of the LAST 24 HOURS (\"daySummary\") and of the LAST 7 DAYS MAX (\"weekSummary\") across the channels and DMs relevant to me: key themes, decisions made, and things awaiting my follow-up. Do NOT read messages older than 7 days.\n\n\
         3) TASKS — concrete work items I should own, extracted from those conversations: bugs reported to me, fixes or code changes requested of me, reviews or investigations asked of me. Not FYIs, not decisions, not other people's work.\n\n\
         My profile: {profile}\n\n\
         Respond with ONLY a JSON object as the final content:\n\
         {{\"items\":[{{\"channel\":\"\",\"from\":\"\",\"from_me\":false,\"text\":\"\",\"ts\":\"\",\"permalink\":\"\",\"kind\":\"explicit\",\"reason\":\"\"}}],\
\"daySummary\":[{{\"text\":\"\",\"channel\":\"\",\"actionable\":false}}],\"weekSummary\":[{{\"text\":\"\",\"channel\":\"\",\"actionable\":false}}],\
\"tasks\":[{{\"key\":\"\",\"title\":\"\",\"detail\":\"\",\"channel\":\"\",\"from\":\"\",\"ts\":\"\",\"permalink\":\"\",\"urgency\":\"normal\"}}]}}\n\
         - items: last 24h only. \"kind\" is \"explicit\" for @mentions/DMs/thread replies, or \"implicit\" for inferred relevance (short justification in \"reason\"). \"from_me\" is true when I wrote the message (include my own only when I'm still waiting on an answer). \"text\" trimmed ~200 chars. \"ts\" = Slack message timestamp. Skip bots. Max 25 items.\n\
         - daySummary: 3-8 granular, self-contained bullet items covering the last 24h. weekSummary: 3-10 items covering the last 7 days max (themes, decisions, pending follow-ups). Each item: \"text\" (1-2 sentences), \"channel\" where it happened, and \"actionable\": true ONLY if it describes concrete work I could delegate to a coding agent (a bug, fix request, code task) — false for FYI/decisions/social.\n\
         - tasks: max 10, last 7 days. \"key\" is a short kebab-case slug derived from the task's core subject (e.g. \"fix-payout-webhook-500s\") — the SAME underlying task must always produce the SAME key across runs, so never include dates or message ids in it. \"title\" is imperative (\"Fix …\", \"Review …\"), \"detail\" 1-2 sentences of context, \"ts\" = timestamp of the triggering message. \"urgency\" is \"high\" ONLY when the messages say it's urgent/blocking/ASAP or production is affected — otherwise \"normal\". Only real, still-open asks — don't invent tasks and skip anything already resolved in the thread.\n\
         If nothing notable, return one item saying so. If Slack is unavailable, return {{\"items\":[],\"daySummary\":[],\"weekSummary\":[],\"tasks\":[]}}.{incremental}"
    )
}

/// Runs the headless claude query and parses items + summaries.
pub fn fetch_via_claude(
    about_me: &str,
    incr: Option<&SlackIncremental>,
) -> Result<SlackAiResult, String> {
    let prompt = build_prompt(about_me, incr);
    let (raw, stderr, success) = run_claude_to_files(
        &[
            "-p",
            &prompt,
            "--output-format",
            "json",
            "--allowedTools",
            "mcp__claude_ai_Slack",
            // Sonnet is plenty for fetch+summarize and much faster/cheaper than
            // the account's default top model for this agentic loop.
            "--model",
            "claude-sonnet-5",
        ],
        // The week-summary pass makes many Slack tool calls; observed runs range
        // ~2-6 min, so give it headroom (the UI shows live status meanwhile).
        420,
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

        let from_me = it["from_me"].as_bool().unwrap_or(false);
        let mut meta = HashMap::new();
        meta.insert("channel".into(), channel.clone());
        meta.insert("from".into(), from.clone());
        meta.insert(
            "direction".into(),
            if from_me { "sent" } else { "received" }.into(),
        );
        meta.insert(
            "kind".into(),
            if channel.eq_ignore_ascii_case("dm") {
                "dm"
            } else if implicit {
                "channel"
            } else {
                "mention"
            }
            .into(),
        );

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
    // Tasks: concrete asks extracted from conversations become inbox tickets.
    // The claude-derived slug keys them, so re-analysis updates the same row
    // instead of duplicating it (and upsert never resurrects a done one).
    for t in obj["tasks"].as_array().cloned().unwrap_or_default().iter() {
        let title = t["title"].as_str().unwrap_or("").trim().to_string();
        if title.is_empty() {
            continue;
        }
        let key = slugify(t["key"].as_str().unwrap_or(&title));
        if key.is_empty() {
            continue;
        }
        let channel = t["channel"].as_str().unwrap_or("Slack").to_string();
        let from = t["from"].as_str().unwrap_or("").to_string();
        let created_ms = t["ts"]
            .as_str()
            .and_then(|ts| ts.split('.').next())
            .and_then(|s| s.parse::<i64>().ok())
            .map(|s| s * 1000)
            .filter(|ms| *ms > 0)
            .unwrap_or_else(now_ms);

        let urgent = t["urgency"].as_str().unwrap_or("normal") == "high";
        let mut meta = HashMap::new();
        meta.insert("channel".into(), channel.clone());
        if !from.is_empty() {
            meta.insert("from".into(), from);
        }
        if urgent {
            meta.insert("priority".into(), "Urgent".into());
        }

        out_items.push(Fetched {
            id: format!("slack:task:{key}"),
            source: "slack",
            ntype: "action_item",
            title,
            snippet: t["detail"].as_str().unwrap_or("").to_string(),
            url: t["permalink"].as_str().map(String::from),
            created_at: created_ms,
            priority: if urgent { 92.0 } else { 80.0 },
            meta,
            relevance: None,
        });
    }

    Ok(SlackAiResult {
        items: out_items,
        day_summary,
        week_summary,
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Normalizes a claude-provided task key into a stable id fragment.
fn slugify(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars().take(80) {
        let lc = c.to_ascii_lowercase();
        if lc.is_ascii_alphanumeric() {
            out.push(lc);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
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

/// One Slack message plus what we know about it, pre-judgment.
struct Msg {
    channel_id: String,
    channel_name: String,
    is_dm: bool,
    ts: String,
    text: String,
    author_id: String,
    from_me: bool,
    mentions_me: bool,
    in_thread: bool,
    reply_count: u64,
}

/// Direct messages (im/mpim) the user is in — best effort: enterprise
/// workspaces may restrict `conversations.list`, in which case only the
/// opted-in channels are read.
async fn dm_channels(client: &reqwest::Client, auth: &SlackAuth) -> Vec<(String, String)> {
    let Ok(body) = api(
        client,
        auth,
        "conversations.list",
        &[
            ("types", "im,mpim"),
            ("exclude_archived", "true"),
            ("limit", "200"),
        ],
    )
    .await
    else {
        return Vec::new();
    };
    body["channels"]
        .as_array()
        .map(|chs| {
            chs.iter()
                .filter_map(|c| {
                    c["id"]
                        .as_str()
                        .map(|id| (id.to_string(), "DM".to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Fast path: reads recent messages from the opted-in channels and the user's
/// DMs over the Web API (milliseconds, no Slack app), then decides what
/// matters:
///  - explicit: @-mentions of the user and DMs from others → always items;
///  - implicit: other channel messages → Jev judges "relevant to the user";
///  - follow-ups: the user's own unanswered asks → Jev judges "awaits a reply".
///
/// Without a Jev key only the explicit rules apply.
pub async fn fetch(
    auth: &SlackAuth,
    channels: &[(String, String)],
    since_ts: f64,
    jev_key: Option<&str>,
    about_me: &str,
) -> Result<(Vec<Fetched>, f64), String> {
    let client = client()?;

    let whoami = api(&client, auth, "auth.test", &[]).await?;
    let me = whoami["user_id"].as_str().unwrap_or_default().to_string();
    if me.is_empty() {
        return Err("Slack didn't return the user id".into());
    }
    let team_url = whoami["url"]
        .as_str()
        .unwrap_or("https://slack.com/")
        .to_string();
    let mention_token = format!("<@{me}>");

    let mut targets: Vec<(String, String, bool)> = channels
        .iter()
        .map(|(id, n)| (id.clone(), n.clone(), false))
        .collect();
    for (id, n) in dm_channels(&client, auth).await {
        if !targets.iter().any(|t| t.0 == id) {
            targets.push((id, n, true));
        }
    }
    if targets.is_empty() {
        return Ok((Vec::new(), since_ts));
    }

    let oldest = format!("{since_ts:.6}");
    let mut msgs: Vec<Msg> = Vec::new();
    let mut newest = since_ts;
    for (channel_id, channel_name, is_dm) in &targets {
        // A channel we can't read shouldn't abort the whole sync.
        let Ok(history) = api(
            &client,
            auth,
            "conversations.history",
            &[
                ("channel", channel_id),
                ("oldest", &oldest),
                ("limit", "100"),
            ],
        )
        .await
        else {
            continue;
        };
        let Some(messages) = history["messages"].as_array() else {
            continue;
        };
        for m in messages {
            // Joins, bots, pins… carry a subtype; real messages don't.
            if m.get("subtype").is_some() || m.get("bot_id").is_some() {
                continue;
            }
            let ts = m["ts"].as_str().unwrap_or_default();
            let text = m["text"].as_str().unwrap_or("");
            if ts.is_empty() || text.trim().is_empty() {
                continue;
            }
            newest = newest.max(ts.parse::<f64>().unwrap_or(0.0));
            let author_id = m["user"].as_str().unwrap_or("").to_string();
            msgs.push(Msg {
                channel_id: channel_id.clone(),
                channel_name: channel_name.clone(),
                is_dm: *is_dm,
                ts: ts.to_string(),
                text: text.to_string(),
                from_me: author_id == me,
                mentions_me: text.contains(&mention_token),
                in_thread: m.get("thread_ts").is_some() && m["thread_ts"].as_str() != Some(ts),
                reply_count: m["reply_count"].as_u64().unwrap_or(0),
                author_id,
            });
        }
    }

    // ---- judgment ----
    // explicit → in; the rest split into Jev candidates (cap keeps a first run bounded).
    let mut keep: Vec<(usize, &'static str, Option<f64>)> = Vec::new(); // (idx, kind, p)
    let mut implicit: Vec<usize> = Vec::new();
    let mut own: Vec<usize> = Vec::new();
    for (i, m) in msgs.iter().enumerate() {
        if m.from_me {
            if m.reply_count == 0 && !m.in_thread && m.text.len() > 12 {
                own.push(i);
            }
        } else if m.mentions_me || m.is_dm {
            keep.push((i, "explicit", None));
        } else {
            implicit.push(i);
        }
    }
    implicit.truncate(150);
    own.truncate(40);

    if let Some(key) = jev_key {
        let jc = crate::jev::client_for_connectors()?;
        let relevant_q = serde_json::json!({
            "relevant": {
                "type": "noul",
                "instructions": "This Slack message concerns the user personally even without an @-mention: their work, a service or code they own, a decision affecting their team, or a question they should answer.",
                "criteria": {
                    "true": "The user would want to read this today and might need to respond or act.",
                    "false": "General chatter, someone else's topic, or information the user doesn't need."
                }
            }
        });
        let awaiting_q = serde_json::json!({
            "awaiting_reply": {
                "type": "noul",
                "instructions": "The user wrote this message. It asks someone for something (a question, a review, a decision, an action) and still expects an answer.",
                "criteria": {
                    "true": "A clear request or question directed at others that would normally get a reply.",
                    "false": "A statement, an answer, an FYI, a reaction, or small talk."
                }
            }
        });
        let judge = |idx: Vec<usize>, q: Value, kind: &'static str, threshold: f64| {
            let jc = jc.clone();
            let key = key.to_string();
            let states: Vec<(usize, Value)> = idx
                .iter()
                .map(|&i| {
                    let m = &msgs[i];
                    (
                        i,
                        serde_json::json!({
                            "channel": m.channel_name,
                            "is_dm": m.is_dm,
                            "in_thread": m.in_thread,
                            "text": m.text.chars().take(1200).collect::<String>(),
                            "about_the_user": about_me.chars().take(600).collect::<String>(),
                        }),
                    )
                })
                .collect();
            async move {
                let mut out: Vec<(usize, &'static str, Option<f64>)> = Vec::new();
                for chunk in states.chunks(8) {
                    let handles: Vec<_> = chunk
                        .iter()
                        .map(|(i, st)| {
                            let (jc, key, q, st, i) =
                                (jc.clone(), key.clone(), q.clone(), st.clone(), *i);
                            tauri::async_runtime::spawn(async move {
                                crate::jev::decide(&jc, &key, st, q)
                                    .await
                                    .map(|a| (i, a[kind]["noul"].as_f64().unwrap_or(0.0)))
                            })
                        })
                        .collect();
                    for h in handles {
                        if let Ok(Ok((i, p))) = h.await {
                            if p >= threshold {
                                out.push((i, kind, Some(p)));
                            }
                        }
                    }
                }
                out
            }
        };
        keep.extend(judge(implicit, relevant_q, "relevant", 0.6).await);
        keep.extend(judge(own, awaiting_q, "awaiting_reply", 0.65).await);
    }

    // ---- items ----
    let mut user_names: HashMap<String, String> = HashMap::new();
    let mut out = Vec::new();
    for (i, kind, p) in keep {
        let m = &msgs[i];
        let author = if m.from_me {
            "You".to_string()
        } else {
            resolve_user(&client, auth, &m.author_id, &mut user_names).await
        };
        let created_ms =
            m.ts.split('.')
                .next()
                .and_then(|s| s.parse::<i64>().ok())
                .map(|s| s * 1000)
                .unwrap_or(0);
        let permalink = format!(
            "{team_url}archives/{}/p{}",
            m.channel_id,
            m.ts.replace('.', "")
        );
        let snippet = humanize(&m.text, &mention_token);

        let mut meta = HashMap::new();
        meta.insert("channel".into(), m.channel_name.clone());
        meta.insert("from".into(), author.clone());
        meta.insert(
            "direction".into(),
            if m.from_me { "sent" } else { "received" }.into(),
        );
        meta.insert(
            "kind".into(),
            if m.is_dm {
                "dm"
            } else if m.mentions_me {
                "mention"
            } else if m.in_thread {
                "thread"
            } else {
                "channel"
            }
            .into(),
        );
        if let Some(p) = p {
            meta.insert("jev_slack_p".into(), format!("{p:.2}"));
        }

        let (ntype, title, priority, relevance) = match kind {
            "awaiting_reply" => (
                "follow_up",
                format!("Waiting for a reply in {}", m.channel_name),
                70.0,
                None,
            ),
            "relevant" => (
                "ai_inferred",
                format!("Relevant in {}", m.channel_name),
                78.0,
                Some(FetchedRelevance {
                    kind: "implicit".into(),
                    score: p.unwrap_or(0.7),
                    reason: format!(
                        "AI judged this {}% likely to concern you",
                        (p.unwrap_or(0.7) * 100.0).round()
                    ),
                }),
            ),
            _ => (
                "mention",
                if m.is_dm {
                    format!("{author} sent you a DM")
                } else {
                    format!("{author} mentioned you in {}", m.channel_name)
                },
                82.0,
                Some(FetchedRelevance {
                    kind: "explicit".into(),
                    score: 1.0,
                    reason: if m.is_dm {
                        "Direct message".into()
                    } else {
                        "Directly addressed to you".into()
                    },
                }),
            ),
        };

        out.push(Fetched {
            id: format!("slack:{}:{}", m.channel_id, m.ts),
            source: "slack",
            ntype,
            title,
            snippet,
            url: Some(permalink),
            created_at: created_ms,
            priority,
            meta,
            relevance,
        });
    }

    Ok((out, newest))
}

async fn resolve_user(
    client: &reqwest::Client,
    auth: &SlackAuth,
    user_id: &str,
    cache: &mut HashMap<String, String>,
) -> String {
    if user_id.is_empty() {
        return "Someone".to_string();
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
fn humanize(text: &str, mention_token: &str) -> String {
    text.replace(mention_token, "@you")
        .chars()
        .take(400)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
