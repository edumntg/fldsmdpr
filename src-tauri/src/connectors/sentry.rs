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
