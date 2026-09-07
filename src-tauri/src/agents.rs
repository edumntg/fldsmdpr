use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

/// GUI apps on macOS get a minimal PATH, so probe common install locations too.
fn orca_bin() -> Option<PathBuf> {
    if let Ok(out) = Command::new("which").arg("orca").output() {
        if out.status.success() {
            let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !p.is_empty() {
                return Some(PathBuf::from(p));
            }
        }
    }
    ["/usr/local/bin/orca", "/opt/homebrew/bin/orca"]
        .iter()
        .map(PathBuf::from)
        .find(|p| p.exists())
}

#[derive(Serialize)]
pub struct OrcaStatus {
    pub installed: bool,
}

#[tauri::command]
pub fn orca_status() -> OrcaStatus {
    OrcaStatus {
        installed: orca_bin().is_some(),
    }
}

fn run_orca_json(bin: &PathBuf, args: &[&str]) -> Result<serde_json::Value, String> {
    let out = Command::new(bin)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run orca: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let msg = if stderr.trim().is_empty() {
            &stdout
        } else {
            &stderr
        };
        return Err(format!(
            "orca {}: {}",
            args.first().unwrap_or(&""),
            msg.trim()
        ));
    }
    serde_json::from_str(stdout.trim()).map_err(|e| format!("Unexpected orca output: {e}"))
}

/// Matches a "owner/name" GitHub slug against Orca's registered repos.
fn resolve_repo_id(bin: &PathBuf, repo_slug: &str) -> Result<String, String> {
    let body = run_orca_json(bin, &["repo", "list", "--json"])?;
    let repos = body["result"]["repos"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let slug_lower = repo_slug.to_lowercase();
    let short_name = repo_slug
        .rsplit('/')
        .next()
        .unwrap_or(repo_slug)
        .to_lowercase();

    for r in &repos {
        if let Some(key) = r["gitRemoteIdentity"]["canonicalKey"].as_str() {
            if key.to_lowercase().ends_with(&format!("/{slug_lower}")) {
                if let Some(id) = r["id"].as_str() {
                    return Ok(id.to_string());
                }
            }
        }
    }
    // fall back to display-name match (repo registered without a remote)
    for r in &repos {
        if r["displayName"].as_str().map(str::to_lowercase) == Some(short_name.clone()) {
            if let Some(id) = r["id"].as_str() {
                return Ok(id.to_string());
            }
        }
    }
    Err(format!(
        "Repo “{repo_slug}” is not registered in Orca. Add it there first (orca repo add <path>)."
    ))
}

/// Resolves a GitHub "owner/name" slug to a local clone path via Orca's
/// registered repos (used to spawn the built-in Claude Code session in the
/// right directory). Returns None if Orca isn't installed or the repo is unknown.
#[tauri::command]
pub fn repo_local_path(repo: String) -> Option<String> {
    let bin = orca_bin()?;
    let body = run_orca_json(&bin, &["repo", "list", "--json"]).ok()?;
    let repos = body["result"]["repos"].as_array()?;
    let slug = repo.to_lowercase();
    let short = repo.rsplit('/').next().unwrap_or(&repo).to_lowercase();
    for r in repos {
        let matches_remote = r["gitRemoteIdentity"]["canonicalKey"]
            .as_str()
            .is_some_and(|k| k.to_lowercase().ends_with(&format!("/{slug}")));
        let matches_name = r["displayName"].as_str().map(str::to_lowercase) == Some(short.clone());
        if matches_remote || matches_name {
            if let Some(path) = r["path"].as_str() {
                return Some(path.to_string());
            }
        }
    }
    None
}

#[derive(Serialize)]
pub struct OrcaRepo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub remote: Option<String>,
}

/// Lists repos registered in Orca (for the "Run in Orca" repo picker).
#[tauri::command]
pub fn orca_repos() -> Result<Vec<OrcaRepo>, String> {
    let bin = orca_bin().ok_or("Orca CLI not found — is Orca installed?")?;
    let body = run_orca_json(&bin, &["repo", "list", "--json"])?;
    let repos = body["result"]["repos"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    Ok(repos
        .iter()
        .filter_map(|r| {
            Some(OrcaRepo {
                id: r["id"].as_str()?.to_string(),
                name: r["displayName"].as_str().unwrap_or("").to_string(),
                path: r["path"].as_str().unwrap_or("").to_string(),
                remote: r["gitRemoteIdentity"]["canonicalKey"]
                    .as_str()
                    .map(String::from),
            })
        })
        .collect())
}

#[derive(Serialize)]
pub struct LaunchResult {
    pub worktree: String,
}

/// Creates an Orca-managed worktree with a Claude agent pre-seeded with the
/// task prompt, and reveals it in the Orca app. `repo_id` (from the picker)
/// wins; otherwise the repo is resolved from the `repo` slug.
#[tauri::command]
pub async fn launch_orca(
    name: String,
    repo: String,
    prompt: String,
    comment: Option<String>,
    repo_id: Option<String>,
) -> Result<LaunchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bin = orca_bin().ok_or("Orca CLI not found — is Orca installed?")?;
        let resolved = match repo_id {
            Some(id) if !id.is_empty() => id,
            _ => resolve_repo_id(&bin, &repo)?,
        };
        let repo_sel = format!("id:{resolved}");

        let mut args: Vec<&str> = vec![
            "worktree",
            "create",
            "--name",
            &name,
            "--repo",
            &repo_sel,
            "--agent",
            "claude",
            "--prompt",
            &prompt,
            "--activate",
            "--json",
        ];
        if let Some(c) = comment.as_deref() {
            args.extend(["--comment", c]);
        }

        let body = run_orca_json(&bin, &args)?;
        if body["ok"].as_bool() != Some(true) {
            return Err(format!(
                "Orca refused the worktree: {}",
                body["error"].as_str().unwrap_or("unknown error")
            ));
        }
        Ok(LaunchResult {
            worktree: body["result"]["worktree"]["name"]
                .as_str()
                .unwrap_or(&name)
                .to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
