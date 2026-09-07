pub mod ai_rounds;
pub mod gcal;
pub mod github;
pub mod linear;
pub mod maccal;
pub mod sentry;
pub mod slack;

use std::collections::HashMap;

/// AI/relevance annotation for a fetched item (drives the "AI: relevant to you"
/// chip). `kind` is "explicit" or "implicit".
pub struct FetchedRelevance {
    pub kind: String,
    pub score: f64,
    pub reason: String,
}

/// A provider-agnostic item produced by a connector fetch, ready to upsert
/// into the notifications table.
pub struct Fetched {
    pub id: String,
    pub source: &'static str,
    pub ntype: &'static str,
    pub title: String,
    pub snippet: String,
    pub url: Option<String>,
    pub created_at: i64, // unix ms
    pub priority: f64,
    pub meta: HashMap<String, String>,
    pub relevance: Option<FetchedRelevance>,
}
