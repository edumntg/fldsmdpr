//! Reads events from the local macOS Calendar app (via JXA / osascript).
//!
//! This works when the user's Google account is added in System Settings →
//! Internet Accounts with Calendars enabled — Apple syncs it locally, so we
//! read it without any Google API, OAuth, app, or public iCal URL. That
//! sidesteps enterprise restrictions that block those. macOS only.

use super::Fetched;
use chrono::{DateTime, Local, Utc};
use std::collections::HashMap;

const IGNORE_DEFAULT: &[&str] = &["Birthdays", "US Holidays", "Siri Suggestions"];

const LIST_SCRIPT: &str = r#"JSON.stringify(Application("Calendar").calendars.name());"#;

// argv[0] = JSON array of calendar names to include (empty = all minus defaults).
const FETCH_SCRIPT: &str = r#"
function run(argv) {
  var selected = [];
  try { selected = JSON.parse(argv[0] || "[]"); } catch (e) {}
  var ignore = ["Birthdays", "US Holidays", "Siri Suggestions"];
  var Cal = Application("Calendar");
  var now = new Date();
  var end = new Date(now.getTime() + 48 * 3600 * 1000);
  var start = new Date(now.getTime() - 3600 * 1000);
  var out = [];
  var cals = Cal.calendars();
  for (var i = 0; i < cals.length; i++) {
    var cal = cals[i];
    var name = cal.name();
    if (selected.length ? selected.indexOf(name) === -1 : ignore.indexOf(name) !== -1) continue;
    var evs;
    try { evs = cal.events.whose({ _and: [{ startDate: { ">": start } }, { startDate: { "<": end } }] })(); }
    catch (e) { continue; }
    for (var j = 0; j < evs.length; j++) {
      var e = evs[j];
      function safe(fn) { try { return fn() || ""; } catch (x) { return ""; } }
      out.push({
        title: safe(function () { return e.summary(); }),
        start: e.startDate().toISOString(),
        location: safe(function () { return e.location(); }),
        url: safe(function () { return e.url(); }),
        notes: safe(function () { return String(e.description()).slice(0, 200); }),
        cal: name,
      });
    }
  }
  return JSON.stringify(out);
}
"#;

#[cfg(target_os = "macos")]
fn run_jxa(script: &str, arg: Option<&str>) -> Result<String, String> {
    use std::process::Command;
    let mut cmd = Command::new("osascript");
    cmd.args(["-l", "JavaScript", "-e", script]);
    if let Some(a) = arg {
        cmd.arg(a);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("Couldn't run osascript: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        // -1743 = not authorized to send Apple events (grant in Privacy settings)
        if err.contains("-1743") || err.to_lowercase().contains("not authoriz") {
            return Err("FLDSMDPR needs permission to read Calendar. Approve it in System Settings → Privacy & Security → Automation (or Calendars).".into());
        }
        return Err(format!("Calendar read failed: {}", err.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(not(target_os = "macos"))]
fn run_jxa(_script: &str, _arg: Option<&str>) -> Result<String, String> {
    Err("Local calendar reading is only available on macOS.".into())
}

pub fn list_calendars() -> Result<Vec<String>, String> {
    let json = run_jxa(LIST_SCRIPT, None)?;
    let all: Vec<String> = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(all
        .into_iter()
        .filter(|c| !IGNORE_DEFAULT.contains(&c.as_str()))
        .collect())
}

pub fn fetch(selected: &[String]) -> Result<Vec<Fetched>, String> {
    let arg = serde_json::to_string(selected).unwrap_or_else(|_| "[]".into());
    let json = run_jxa(FETCH_SCRIPT, Some(&arg))?;
    let events: Vec<serde_json::Value> = serde_json::from_str(&json).map_err(|e| e.to_string())?;

    let now = Utc::now();
    let mut out = Vec::new();
    for ev in &events {
        let Some(start) = ev["start"]
            .as_str()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&Utc))
        else {
            continue;
        };

        let minutes_until = (start - now).num_minutes();
        let base = if minutes_until <= 15 {
            92.0
        } else if minutes_until <= 60 {
            84.0
        } else if start.with_timezone(&Local).date_naive() == now.with_timezone(&Local).date_naive()
        {
            64.0
        } else {
            52.0
        };
        let priority = base - (minutes_until.max(0) as f64) * 0.001;

        let local = start.with_timezone(&Local);
        let time_label = local.format("%a %-I:%M %p").to_string();
        let title = ev["title"].as_str().unwrap_or("(no title)").to_string();
        let location = ev["location"].as_str().unwrap_or("");
        let url = ev["url"]
            .as_str()
            .filter(|u| u.starts_with("http"))
            .map(String::from);
        let cal = ev["cal"].as_str().unwrap_or("");

        let mut snippet = time_label.clone();
        if !location.is_empty() && !location.starts_with("http") {
            snippet.push_str(&format!(" · {location}"));
        }
        if !cal.is_empty() {
            snippet.push_str(&format!(" · {cal}"));
        }

        let mut meta = HashMap::new();
        meta.insert("time".into(), time_label);
        if let Some(u) = &url {
            meta.insert("link".into(), u.clone());
        }

        // Include a title fragment so two events starting at the same instant
        // in the same calendar don't collapse into one notification.
        let title_key: String = title
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .take(16)
            .collect();
        out.push(Fetched {
            id: format!("maccal:{}:{}:{}", cal, start.timestamp(), title_key),
            source: "gcal",
            ntype: "event",
            title,
            snippet,
            url,
            created_at: start.timestamp_millis(),
            priority,
            meta,
            relevance: None,
        });
    }
    Ok(out)
}
