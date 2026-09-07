pub mod github;
pub mod linear;
pub mod slack;

use std::collections::HashMap;

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
}
