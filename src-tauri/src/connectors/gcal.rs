use super::Fetched;
use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use std::collections::HashMap;

/// Validates a secret iCal URL by fetching it and confirming it's a calendar.
pub async fn validate(url: &str) -> Result<String, String> {
    let text = get_ics(url).await?;
    if !text.contains("BEGIN:VCALENDAR") {
        return Err("That URL didn't return a calendar. Use the “Secret address in iCal format” from Google Calendar settings.".into());
    }
    let name = property(&text, "X-WR-CALNAME").unwrap_or_else(|| "Calendar".to_string());
    Ok(name)
}

pub async fn fetch(url: &str) -> Result<Vec<Fetched>, String> {
    let text = get_ics(url).await?;
    let now = Utc::now();
    let horizon = now + chrono::Duration::hours(48);

    let mut out = Vec::new();
    for ev in parse_events(&text) {
        let Some(start) = ev.start else { continue };
        // Show events from an hour ago (in-progress) through the next 48h.
        if start < now - chrono::Duration::hours(1) || start > horizon {
            continue;
        }

        let minutes_until = (start - now).num_minutes();
        // Sooner meetings rank higher; the small time term keeps each bucket chronological.
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
        let join = ev.join_link();

        let mut meta = HashMap::new();
        meta.insert("time".into(), time_label.clone());
        if let Some(link) = &join {
            meta.insert("link".into(), link.clone());
        }
        if let Some(loc) = &ev.location {
            meta.insert("location".into(), loc.clone());
        }

        let mut snippet = time_label.clone();
        if let Some(loc) = &ev.location {
            if !loc.starts_with("http") {
                snippet.push_str(&format!(" · {loc}"));
            }
        }
        if let Some(desc) = &ev.description {
            let d = desc.chars().take(160).collect::<String>();
            if !d.trim().is_empty() {
                snippet.push_str(&format!(
                    " — {}",
                    d.split_whitespace().collect::<Vec<_>>().join(" ")
                ));
            }
        }

        out.push(Fetched {
            id: format!(
                "gcal:{}",
                ev.uid
                    .clone()
                    .unwrap_or_else(|| format!("{}", start.timestamp()))
            ),
            source: "gcal",
            ntype: "event",
            title: ev.summary.clone().unwrap_or_else(|| "(no title)".into()),
            snippet,
            url: join,
            created_at: start.timestamp_millis(),
            priority,
            meta,
        });
    }

    Ok(out)
}

async fn get_ics(url: &str) -> Result<String, String> {
    let url = url.trim();
    if !url.starts_with("http") {
        return Err("Paste the full https:// iCal URL".into());
    }
    let client = reqwest::Client::builder()
        .user_agent("fldsmdpr/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Calendar request failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Calendar fetch failed (HTTP {})", res.status()));
    }
    res.text().await.map_err(|e| e.to_string())
}

struct Event {
    uid: Option<String>,
    summary: Option<String>,
    description: Option<String>,
    location: Option<String>,
    conference: Option<String>,
    start: Option<DateTime<Utc>>,
}

impl Event {
    /// Best-effort video-call link: explicit conference field, else a URL in
    /// location/description (Meet/Zoom/Teams or any https link).
    fn join_link(&self) -> Option<String> {
        if let Some(c) = &self.conference {
            if c.starts_with("http") {
                return Some(c.clone());
            }
        }
        for text in [&self.location, &self.description].into_iter().flatten() {
            if let Some(link) = find_url(text) {
                return Some(link);
            }
        }
        None
    }
}

fn find_url(text: &str) -> Option<String> {
    text.split(|c: char| c.is_whitespace() || c == '<' || c == '>' || c == '"')
        .find(|tok| tok.starts_with("https://") && tok.len() > 12)
        .map(|s| s.trim_end_matches(&[',', '.', ')'][..]).to_string())
}

/// Unfolds RFC 5545 line folding (continuation lines start with space/tab).
fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.split(['\n']).map(|l| l.trim_end_matches('\r')) {
        if (raw.starts_with(' ') || raw.starts_with('\t')) && !lines.is_empty() {
            lines.last_mut().unwrap().push_str(&raw[1..]);
        } else {
            lines.push(raw.to_string());
        }
    }
    lines
}

fn parse_events(text: &str) -> Vec<Event> {
    let mut events = Vec::new();
    let mut cur: Option<Event> = None;
    for line in unfold(text) {
        if line == "BEGIN:VEVENT" {
            cur = Some(Event {
                uid: None,
                summary: None,
                description: None,
                location: None,
                conference: None,
                start: None,
            });
        } else if line == "END:VEVENT" {
            if let Some(ev) = cur.take() {
                events.push(ev);
            }
        } else if let Some(ev) = cur.as_mut() {
            let Some(colon) = line.find(':') else {
                continue;
            };
            let (name_part, value) = line.split_at(colon);
            let value = unescape(&value[1..]);
            let name = name_part.split(';').next().unwrap_or(name_part);
            match name {
                "UID" => ev.uid = Some(value),
                "SUMMARY" => ev.summary = Some(value),
                "DESCRIPTION" => ev.description = Some(value),
                "LOCATION" => ev.location = Some(value),
                "X-GOOGLE-CONFERENCE" => ev.conference = Some(value),
                "DTSTART" => ev.start = parse_dt(name_part, &value),
                _ => {}
            }
        }
    }
    events
}

fn unescape(s: &str) -> String {
    s.replace("\\n", " ")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
}

/// Parses DTSTART in the common forms Google emits: UTC (…Z), floating/TZID
/// local (interpreted in the machine's local zone), and all-day (VALUE=DATE).
fn parse_dt(name_part: &str, value: &str) -> Option<DateTime<Utc>> {
    if name_part.contains("VALUE=DATE") || (value.len() == 8 && !value.contains('T')) {
        let date = NaiveDate::parse_from_str(value, "%Y%m%d").ok()?;
        let naive = date.and_hms_opt(0, 0, 0)?;
        return Local
            .from_local_datetime(&naive)
            .single()
            .map(|d| d.with_timezone(&Utc));
    }
    if let Some(stripped) = value.strip_suffix('Z') {
        let naive = NaiveDateTime::parse_from_str(stripped, "%Y%m%dT%H%M%S").ok()?;
        return Some(Utc.from_utc_datetime(&naive));
    }
    // TZID or floating local time — best effort in local zone.
    let naive = NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%S").ok()?;
    Local
        .from_local_datetime(&naive)
        .single()
        .map(|d| d.with_timezone(&Utc))
}

fn property(text: &str, name: &str) -> Option<String> {
    unfold(text).into_iter().find_map(|line| {
        let prefix = format!("{name}:");
        line.strip_prefix(&prefix).map(unescape)
    })
}
