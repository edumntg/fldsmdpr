//! Shared plumbing for running the headless `claude` CLI from the GUI app
//! (Ask, Notion/Granola rounds, agent terminals).

use serde_json::Value;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub fn claude_bin() -> Option<PathBuf> {
    if let Ok(out) = Command::new("which").arg("claude").output() {
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

/// Appends a diagnostic line to ~/Library/Logs/FLDSMDPR/claude-cli.log. Logs
/// mechanics only (timings, exit codes, error strings) — never content.
fn ai_log(line: &str) {
    let Some(home) = dirs_home() else { return };
    let dir = home.join("Library/Logs/FLDSMDPR");
    let _ = std::fs::create_dir_all(&dir);
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let entry = format!("[{ts}] {line}\n");
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("claude-cli.log"))
    {
        let _ = f.write_all(entry.as_bytes());
    }
}

/// Runs claude (by full path) with **stdin closed** and **stdout/stderr
/// redirected to temp files**, with a hard timeout. Both details are load-
/// bearing, learned from real hangs when spawned from the GUI app:
///  - `claude -p` waits for EOF on a non-TTY stdin, so stdin must be null;
///  - piped stdout/stderr that nobody drains fill up (64KB) and deadlock the
///    child mid-run — real files have no such limit.
pub fn run_claude_to_files(args: &[&str], secs: u64) -> Result<(String, String, bool), String> {
    use std::fs;

    let bin = claude_bin().ok_or("The `claude` CLI wasn't found on this machine.")?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let base = std::env::temp_dir().join(format!("fldsmdpr-claude-{}-{nanos}", std::process::id()));
    let out_path = base.with_extension("out");
    let err_path = base.with_extension("err");
    let out_file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
    let err_file = fs::File::create(&err_path).map_err(|e| e.to_string())?;

    let mut child = Command::new(&bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(out_file))
        .stderr(Stdio::from(err_file))
        .spawn()
        .map_err(|e| format!("Couldn't run claude: {e}"))?;

    let start = Instant::now();
    let status = loop {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
            break st;
        }
        if start.elapsed() > Duration::from_secs(secs) {
            let _ = child.kill();
            let _ = child.wait();
            let err_head: String = fs::read_to_string(&err_path)
                .unwrap_or_default()
                .chars()
                .take(300)
                .collect();
            ai_log(&format!(
                "TIMEOUT after {secs}s; args[0..2]={:?}; stderr_head={err_head:?}",
                &args[..args.len().min(2)]
            ));
            let _ = fs::remove_file(&out_path);
            let _ = fs::remove_file(&err_path);
            return Err(format!("claude timed out after {secs}s"));
        }
        std::thread::sleep(Duration::from_millis(300));
    };

    let stdout = fs::read_to_string(&out_path).unwrap_or_default();
    let stderr = fs::read_to_string(&err_path).unwrap_or_default();
    let _ = fs::remove_file(&out_path);
    let _ = fs::remove_file(&err_path);
    ai_log(&format!(
        "claude {:?} finished in {}s; success={}; stdout={}B stderr={}B",
        &args[..args.len().min(2)],
        start.elapsed().as_secs(),
        status.success(),
        stdout.len(),
        stderr.len()
    ));
    Ok((stdout, stderr, status.success()))
}

/// claude's stdout can contain several concatenated JSON objects; the answer is
/// the one with `"type":"result"` (kept last if repeated).
pub fn result_envelope(raw: &str) -> Option<Value> {
    let mut envelope = None;
    for v in serde_json::Deserializer::from_str(raw.trim()).into_iter::<Value>() {
        match v {
            Ok(v) if v["type"] == "result" || v.get("result").is_some() => envelope = Some(v),
            Ok(_) => {}
            Err(_) => break,
        }
    }
    envelope
}

/// Extracts the first balanced `{…}` from text that may be wrapped in prose or
/// ```json fences (the org compliance layer can prepend a warning).
pub fn extract_json_object(s: &str) -> Option<&str> {
    let start = s.find('{')?;
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
        } else if c == '{' {
            depth += 1;
        } else if c == '}' {
            depth -= 1;
            if depth == 0 {
                return Some(&s[start..=i]);
            }
        }
    }
    None
}
