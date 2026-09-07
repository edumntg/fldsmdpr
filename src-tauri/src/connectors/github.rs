use super::Fetched;
use std::collections::HashMap;

pub const SSO_ERROR: &str =
    "Your GitHub token needs SAML SSO authorization for your organization. \
Open github.com/settings/tokens, click “Configure SSO” next to the token, and authorize your orgs.";

pub fn sso_required(res: &reqwest::Response) -> bool {
    res.headers()
        .get("x-github-sso")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("required"))
}

/// (search qualifier, notification type, base priority) — first match wins
/// when the same issue/PR shows up in several categories.
const CATEGORIES: &[(&str, &str, f64)] = &[
    (
        "is:open is:pr review-requested:@me archived:false",
        "pr_review",
        90.0,
    ),
    ("is:open mentions:@me archived:false", "mention", 78.0),
    ("is:open assignee:@me archived:false", "assigned", 70.0),
];

/// Returns the fetched items plus a `complete` flag: false when any category
/// has more open items than one page returned — in that case the caller must
/// NOT auto-resolve, or still-open items beyond the page get marked done.
pub async fn fetch(token: &str) -> Result<(Vec<Fetched>, bool), String> {
    let client = reqwest::Client::builder()
        .user_agent("fldsmdpr/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let mut by_id: HashMap<i64, Fetched> = HashMap::new();
    let mut complete = true;

    for (query, ntype, base_priority) in CATEGORIES {
        let res = client
            .get("https://api.github.com/search/issues")
            .query(&[("q", *query), ("per_page", "100"), ("sort", "updated")])
            .bearer_auth(token)
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| format!("GitHub request failed: {e}"))?;

        // An enterprise that enforces SAML SSO answers 200 with empty results
        // but flags the unauthorized token here — surface it instead of
        // showing a silently empty inbox.
        if sso_required(&res) {
            return Err(SSO_ERROR.into());
        }
        if !res.status().is_success() {
            return Err(format!("GitHub sync failed (HTTP {})", res.status()));
        }
        let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        let Some(items) = body["items"].as_array() else {
            continue;
        };
        if body["total_count"].as_i64().unwrap_or(0) > items.len() as i64 {
            complete = false;
        }

        for item in items {
            let Some(gh_id) = item["id"].as_i64() else {
                continue;
            };
            // keep the highest-priority categorization only
            if by_id.contains_key(&gh_id) {
                continue;
            }

            let number = item["number"].as_i64().unwrap_or(0);
            let is_pr = item.get("pull_request").is_some();
            let repo = item["repository_url"]
                .as_str()
                .and_then(|u| u.split("/repos/").nth(1))
                .unwrap_or("")
                .to_string();
            let author = item["user"]["login"].as_str().unwrap_or("").to_string();
            let raw_title = item["title"].as_str().unwrap_or("(untitled)");
            let body_text: String = item["body"]
                .as_str()
                .unwrap_or("")
                .chars()
                .take(220)
                .collect::<String>()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");

            let title = match *ntype {
                "pr_review" => format!("Review requested: {raw_title}"),
                "mention" => format!("Mentioned: {raw_title}"),
                _ if is_pr => format!("Assigned PR: {raw_title}"),
                _ => format!("Assigned: {raw_title}"),
            };

            let updated_ms = item["updated_at"]
                .as_str()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|d| d.timestamp_millis())
                .unwrap_or(0);
            // small recency boost so fresh items rank first within a category
            let recency_boost = if chrono::Utc::now().timestamp_millis() - updated_ms < 86_400_000 {
                5.0
            } else {
                0.0
            };

            let mut meta = HashMap::new();
            meta.insert("repo".into(), repo.clone());
            meta.insert("number".into(), format!("#{number}"));
            meta.insert("is_pr".into(), is_pr.to_string());
            // Only open items are fetched (is:open), so state is "open" here;
            // the field lets the UI colour merged/closed correctly if that changes.
            meta.insert(
                "state".into(),
                item["state"].as_str().unwrap_or("open").to_string(),
            );
            if !author.is_empty() {
                meta.insert("author".into(), author);
            }

            by_id.insert(
                gh_id,
                Fetched {
                    id: format!("gh:{gh_id}"),
                    source: "github",
                    ntype,
                    title,
                    snippet: format!(
                        "{repo} #{number}{}",
                        if body_text.is_empty() {
                            String::new()
                        } else {
                            format!(" — {body_text}")
                        }
                    ),
                    url: item["html_url"].as_str().map(String::from),
                    created_at: updated_ms,
                    priority: base_priority + recency_boost,
                    meta,
                    relevance: None,
                },
            );
        }
    }

    Ok((by_id.into_values().collect(), complete))
}
