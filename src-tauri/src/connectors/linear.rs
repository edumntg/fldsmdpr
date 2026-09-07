use super::Fetched;
use serde_json::json;
use std::collections::HashMap;

const QUERY: &str = "
{
  viewer {
    assignedIssues(
      first: 50
      orderBy: updatedAt
      filter: { state: { type: { nin: [\"completed\", \"canceled\"] } } }
    ) {
      nodes {
        id
        identifier
        title
        description
        url
        updatedAt
        priority
        priorityLabel
        state { name }
        team { key name }
        cycle { number }
        project { name lead { displayName } }
      }
    }
  }
}";

pub async fn fetch(token: &str) -> Result<Vec<Fetched>, String> {
    let client = reqwest::Client::builder()
        .user_agent("fldsmdpr/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .post("https://api.linear.app/graphql")
        .header("Authorization", token)
        .json(&json!({ "query": QUERY }))
        .send()
        .await
        .map_err(|e| format!("Linear request failed: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("Linear sync failed (HTTP {})", res.status()));
    }
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if let Some(errors) = body["errors"].as_array() {
        if let Some(first) = errors.first() {
            return Err(format!(
                "Linear sync failed: {}",
                first["message"].as_str().unwrap_or("GraphQL error")
            ));
        }
    }

    let nodes = body["data"]["viewer"]["assignedIssues"]["nodes"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    let mut out = Vec::new();
    for issue in &nodes {
        let Some(id) = issue["id"].as_str() else {
            continue;
        };
        let identifier = issue["identifier"].as_str().unwrap_or("?");
        let title = issue["title"].as_str().unwrap_or("(untitled)");
        let priority_label = issue["priorityLabel"].as_str().unwrap_or("");
        let state_name = issue["state"]["name"].as_str().unwrap_or("");
        let cycle = issue["cycle"]["number"].as_i64();

        let description: String = issue["description"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(220)
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");

        let updated_ms = issue["updatedAt"]
            .as_str()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.timestamp_millis())
            .unwrap_or(0);

        // Linear priority: 0 none, 1 urgent, 2 high, 3 normal, 4 low
        let base: f64 = match issue["priority"].as_i64().unwrap_or(0) {
            1 => 84.0,
            2 => 76.0,
            3 => 70.0,
            4 => 64.0,
            _ => 66.0,
        };
        let recency_boost = if chrono::Utc::now().timestamp_millis() - updated_ms < 86_400_000 {
            4.0
        } else {
            0.0
        };

        let mut snippet_parts: Vec<String> = Vec::new();
        if !priority_label.is_empty() {
            snippet_parts.push(priority_label.to_string());
        }
        if !state_name.is_empty() {
            snippet_parts.push(state_name.to_string());
        }
        if let Some(c) = cycle {
            snippet_parts.push(format!("Cycle {c}"));
        }
        let prefix = snippet_parts.join(" · ");

        let mut meta = HashMap::new();
        meta.insert("key".into(), identifier.to_string());
        if !priority_label.is_empty() {
            meta.insert("priority".into(), priority_label.to_string());
        }
        if !state_name.is_empty() {
            meta.insert("state".into(), state_name.to_string());
        }
        if let Some(c) = cycle {
            meta.insert("cycle".into(), format!("Cycle {c}"));
        }
        if let Some(team) = issue["team"]["name"]
            .as_str()
            .or(issue["team"]["key"].as_str())
        {
            meta.insert("team".into(), team.to_string());
        }
        if let Some(project) = issue["project"]["name"].as_str() {
            meta.insert("project".into(), project.to_string());
        }
        if let Some(lead) = issue["project"]["lead"]["displayName"].as_str() {
            meta.insert("lead".into(), lead.to_string());
        }

        out.push(Fetched {
            id: format!("lin:{id}"),
            source: "linear",
            ntype: "ticket",
            title: format!("{identifier}: {title}"),
            snippet: if description.is_empty() {
                prefix.clone()
            } else if prefix.is_empty() {
                description
            } else {
                format!("{prefix} — {description}")
            },
            url: issue["url"].as_str().map(String::from),
            created_at: updated_ms,
            priority: base + recency_boost,
            meta,
            relevance: None,
        });
    }

    Ok(out)
}
