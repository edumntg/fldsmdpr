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

/// Unresolved issues assigned to the user across their orgs. Returns items plus
/// a `complete` flag (safe-to-auto-resolve, same contract as GitHub).
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
    let mut complete = true;

    for org in orgs.as_array().cloned().unwrap_or_default() {
        let Some(slug) = org["slug"].as_str() else {
            continue;
        };
        let res = client
            .get(format!(
                "https://sentry.io/api/0/organizations/{slug}/issues/"
            ))
            .query(&[
                ("query", "is:unresolved assigned:me"),
                ("limit", "100"),
                ("sort", "date"),
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

            out.push(Fetched {
                id: format!("sentry:{id}"),
                source: "sentry",
                ntype: "incident",
                title: format!("[{level}] {title}"),
                snippet: format!(
                    "{project}{}{culprit} · {count} events",
                    if culprit.is_empty() { "" } else { " · " }
                ),
                url: issue["permalink"].as_str().map(String::from),
                created_at: last_seen_ms,
                priority: if level == "fatal" || level == "error" {
                    86.0
                } else {
                    72.0
                },
                meta,
                relevance: None,
            });
        }
    }

    Ok((out, complete))
}
