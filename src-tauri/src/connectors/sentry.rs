use super::Fetched;
use std::collections::HashMap;

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("fldsmdpr/0.1")
        .build()
        .map_err(|e| e.to_string())
}

/// Validates a Sentry user auth token by listing the orgs it can see.
pub async fn validate(token: &str) -> Result<String, String> {
    let client = client()?;
    let res = client
        .get("https://sentry.io/api/0/organizations/")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Sentry request failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Sentry rejected the token (HTTP {})", res.status()));
    }
    let orgs: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let names: Vec<&str> = orgs
        .as_array()
        .map(|a| a.iter().filter_map(|o| o["slug"].as_str()).collect())
        .unwrap_or_default();
    if names.is_empty() {
        return Err("Token is valid but sees no organizations (add org:read scope).".into());
    }
    Ok(names.join(", "))
}

/// Per-org queries, highest urgency first — an issue matching an earlier query
/// keeps that categorization. (assigned:me boosts priority; the org-wide pass
/// covers users with nothing assigned, active in the last 14 days.)
const QUERIES: &[(&str, f64)] = &[
    ("is:unresolved assigned:me", 90.0),
    ("is:unresolved", 0.0), // 0 = use the level-based priority
];

/// Unresolved issues across the user's orgs (assigned-to-me ranked first, then
/// everything unresolved org-wide). Returns items plus a `complete` flag
/// (safe-to-auto-resolve, same contract as GitHub).
pub async fn fetch(token: &str) -> Result<(Vec<Fetched>, bool), String> {
    let client = client()?;

    let orgs: serde_json::Value = client
        .get("https://sentry.io/api/0/organizations/")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Sentry request failed: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut complete = true;

    for org in orgs.as_array().cloned().unwrap_or_default() {
        let Some(slug) = org["slug"].as_str() else {
            continue;
        };
        for (query, boost) in QUERIES {
            let res = client
                .get(format!(
                    "https://sentry.io/api/0/organizations/{slug}/issues/"
                ))
                .query(&[
                    ("query", *query),
                    ("limit", "100"),
                    ("sort", "date"),
                    ("statsPeriod", "14d"),
                ])
                .bearer_auth(token)
                .send()
                .await
                .map_err(|e| format!("Sentry issues fetch failed: {e}"))?;
            if !res.status().is_success() {
                return Err(format!(
                    "Sentry issues fetch failed (HTTP {})",
                    res.status()
                ));
            }
            let issues: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
            let list = issues.as_array().cloned().unwrap_or_default();
            if list.len() >= 100 {
                complete = false;
            }

            for issue in &list {
                let Some(id) = issue["id"].as_str() else {
                    continue;
                };
                if !seen.insert(id.to_string()) {
                    continue;
                }
                let assigned = *boost > 0.0;
                let title = issue["title"].as_str().unwrap_or("(untitled error)");
                let culprit = issue["culprit"].as_str().unwrap_or("");
                let count = issue["count"].as_str().unwrap_or("?");
                let level = issue["level"].as_str().unwrap_or("error");
                let project = issue["project"]["slug"].as_str().unwrap_or("");
                let last_seen_ms = issue["lastSeen"]
                    .as_str()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|d| d.timestamp_millis())
                    .unwrap_or(0);

                let mut meta = HashMap::new();
                meta.insert("project".into(), project.to_string());
                meta.insert("level".into(), level.to_string());
                meta.insert("count".into(), count.to_string());
                if !culprit.is_empty() {
                    meta.insert("culprit".into(), culprit.to_string());
                }
                if assigned {
                    meta.insert("priority".into(), "High".into());
                }

                out.push(Fetched {
                    id: format!("sentry:{id}"),
                    source: "sentry",
                    ntype: "incident",
                    title: format!("[{level}] {title}"),
                    snippet: format!(
                        "{project}{}{culprit} · {count} events{}",
                        if culprit.is_empty() { "" } else { " · " },
                        if assigned { " · assigned to you" } else { "" }
                    ),
                    url: issue["permalink"].as_str().map(String::from),
                    created_at: last_seen_ms,
                    priority: if assigned {
                        *boost
                    } else if level == "fatal" || level == "error" {
                        76.0
                    } else {
                        64.0
                    },
                    meta,
                    relevance: None,
                });
            }
        }
    }

    Ok((out, complete))
}

// ---- Issue detail (enough context for an agent to fix it) ----

#[derive(serde::Serialize)]
pub struct SentryFrame {
    pub function: String,
    pub file: String,
    pub line: i64,
    pub in_app: bool,
    /// Source context around the crashing line, when Sentry has it.
    pub code: Option<String>,
}

#[derive(serde::Serialize)]
pub struct SentryIssueDetail {
    pub culprit: String,
    pub level: String,
    pub status: String,
    pub count: String,
    pub user_count: i64,
    pub first_seen: String,
    pub last_seen: String,
    pub project: String,
    pub permalink: String,
    pub exception_type: String,
    pub exception_value: String,
    pub frames: Vec<SentryFrame>,
    pub tags: Vec<(String, String)>,
    pub message: String,
}

/// Full issue context: metadata plus the latest event's exception chain,
/// stack trace (with source context) and tags.
pub async fn issue_detail(token: &str, issue_id: &str) -> Result<SentryIssueDetail, String> {
    let client = client()?;
    let get = |url: String| client.get(url).bearer_auth(token).send();

    let res = get(format!("https://sentry.io/api/0/issues/{issue_id}/"))
        .await
        .map_err(|e| format!("Sentry request failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Sentry issue fetch failed (HTTP {})", res.status()));
    }
    let issue: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    let res = get(format!(
        "https://sentry.io/api/0/issues/{issue_id}/events/latest/"
    ))
    .await
    .map_err(|e| format!("Sentry request failed: {e}"))?;
    let event: serde_json::Value = if res.status().is_success() {
        res.json().await.map_err(|e| e.to_string())?
    } else {
        serde_json::Value::Null
    };

    // Walk the event entries for the exception (last value = outermost error)
    // and the log message, if any.
    let mut exception_type = String::new();
    let mut exception_value = String::new();
    let mut frames = Vec::new();
    let mut message = String::new();
    for entry in event["entries"].as_array().cloned().unwrap_or_default() {
        match entry["type"].as_str().unwrap_or("") {
            "exception" => {
                let Some(exc) = entry["data"]["values"]
                    .as_array()
                    .and_then(|v| v.last())
                    .cloned()
                else {
                    continue;
                };
                exception_type = exc["type"].as_str().unwrap_or("").to_string();
                exception_value = exc["value"].as_str().unwrap_or("").to_string();
                let raw = exc["stacktrace"]["frames"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                // Sentry orders frames oldest→newest; keep the newest 25.
                for f in raw.iter().rev().take(25) {
                    let code = f["context"].as_array().map(|lines| {
                        lines
                            .iter()
                            .filter_map(|l| {
                                let pair = l.as_array()?;
                                let ln = pair.first()?.as_i64()?;
                                let src = pair.get(1)?.as_str()?;
                                let marker = if Some(ln) == f["lineNo"].as_i64() {
                                    "→"
                                } else {
                                    " "
                                };
                                Some(format!("{marker}{ln:>5}  {src}"))
                            })
                            .collect::<Vec<_>>()
                            .join("\n")
                    });
                    frames.push(SentryFrame {
                        function: f["function"].as_str().unwrap_or("?").to_string(),
                        file: f["filename"]
                            .as_str()
                            .or(f["absPath"].as_str())
                            .unwrap_or("?")
                            .to_string(),
                        line: f["lineNo"].as_i64().unwrap_or(0),
                        in_app: f["inApp"].as_bool().unwrap_or(false),
                        code: code.filter(|c| !c.is_empty()),
                    });
                }
            }
            "message" => {
                message = entry["data"]["formatted"]
                    .as_str()
                    .or(entry["data"]["message"].as_str())
                    .unwrap_or("")
                    .to_string();
            }
            _ => {}
        }
    }

    let tags = event["tags"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    Some((
                        t["key"].as_str()?.to_string(),
                        t["value"].as_str()?.to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(SentryIssueDetail {
        culprit: issue["culprit"].as_str().unwrap_or("").to_string(),
        level: issue["level"].as_str().unwrap_or("error").to_string(),
        status: issue["status"].as_str().unwrap_or("").to_string(),
        count: issue["count"].as_str().unwrap_or("?").to_string(),
        user_count: issue["userCount"].as_i64().unwrap_or(0),
        first_seen: issue["firstSeen"].as_str().unwrap_or("").to_string(),
        last_seen: issue["lastSeen"].as_str().unwrap_or("").to_string(),
        project: issue["project"]["slug"].as_str().unwrap_or("").to_string(),
        permalink: issue["permalink"].as_str().unwrap_or("").to_string(),
        exception_type,
        exception_value,
        frames,
        tags,
        message,
    })
}
