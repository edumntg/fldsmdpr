use rusqlite::Connection;
use std::path::Path;

/// Schema migrations, applied in order. `user_version` tracks the last applied index + 1.
const MIGRATIONS: &[&str] = &[
    // v1 — core schema
    "
    CREATE TABLE notifications (
        id              TEXT PRIMARY KEY,
        source          TEXT NOT NULL,             -- github | slack | linear | gcal | agent
        type            TEXT NOT NULL,             -- pr_review | mention | ai_inferred | ticket | event | agent_done | ...
        title           TEXT NOT NULL,
        snippet         TEXT NOT NULL DEFAULT '',
        url             TEXT,
        created_at      INTEGER NOT NULL,          -- unix ms
        priority        REAL NOT NULL DEFAULT 0,
        state           TEXT NOT NULL DEFAULT 'unread', -- unread | read | snoozed | done
        snoozed_until   INTEGER,
        relevance_kind  TEXT,                      -- explicit | implicit
        relevance_score REAL,
        relevance_reason TEXT,
        context_json    TEXT NOT NULL DEFAULT '{}',
        group_key       TEXT
    );
    CREATE INDEX idx_notifications_state ON notifications(state, priority DESC, created_at DESC);
    CREATE INDEX idx_notifications_group ON notifications(group_key);

    CREATE TABLE sources (
        id            TEXT PRIMARY KEY,
        kind          TEXT NOT NULL,
        account_label TEXT NOT NULL DEFAULT '',
        scopes        TEXT NOT NULL DEFAULT '',
        last_sync_at  INTEGER,
        cursor_json   TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE profile (
        id   INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE triage_feedback (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        notification_id TEXT NOT NULL REFERENCES notifications(id),
        verdict         TEXT NOT NULL,             -- relevant | not_relevant
        created_at      INTEGER NOT NULL
    );

    CREATE TABLE agent_sessions (
        id              TEXT PRIMARY KEY,
        notification_id TEXT REFERENCES notifications(id),
        mode            TEXT NOT NULL,             -- headless | interactive
        repo_path       TEXT,
        worktree_path   TEXT,
        status          TEXT NOT NULL DEFAULT 'running', -- running | done | failed | stopped | needs_input
        started_at      INTEGER NOT NULL,
        ended_at        INTEGER,
        log_path        TEXT
    );

    CREATE TABLE repos (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        remote_url     TEXT NOT NULL UNIQUE,
        local_path     TEXT NOT NULL,
        default_branch TEXT NOT NULL DEFAULT 'main'
    );

    CREATE TABLE kv (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE notifications_fts USING fts5(
        title, snippet, content='notifications', content_rowid='rowid'
    );
    CREATE TRIGGER notifications_ai AFTER INSERT ON notifications BEGIN
        INSERT INTO notifications_fts(rowid, title, snippet) VALUES (new.rowid, new.title, new.snippet);
    END;
    CREATE TRIGGER notifications_ad AFTER DELETE ON notifications BEGIN
        INSERT INTO notifications_fts(notifications_fts, rowid, title, snippet) VALUES('delete', old.rowid, old.title, old.snippet);
    END;
    CREATE TRIGGER notifications_au AFTER UPDATE ON notifications BEGIN
        INSERT INTO notifications_fts(notifications_fts, rowid, title, snippet) VALUES('delete', old.rowid, old.title, old.snippet);
        INSERT INTO notifications_fts(rowid, title, snippet) VALUES (new.rowid, new.title, new.snippet);
    END;
    ",
];

pub fn open(path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
        conn.execute_batch(sql)?;
        conn.pragma_update(None, "user_version", (i + 1) as i64)?;
    }
    Ok(())
}
