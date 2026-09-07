use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

const SERVICE: &str = "com.eduardomontilva.fldsmdpr";
/// All secrets live in ONE keychain item as a JSON object. Ad-hoc-signed dev
/// builds get a fresh code identity every rebuild, which makes macOS re-ask
/// permission per keychain item — one blob means one prompt instead of one
/// per token (GitHub, Linear, Sentry, Slack ×2, …).
const BLOB_KEY: &str = "secrets";

/// In-memory copy of the blob, loaded from the keychain at most once per app
/// launch (`None` inside the Option = not loaded yet).
fn store() -> &'static Mutex<Option<HashMap<String, String>>> {
    static STORE: OnceLock<Mutex<Option<HashMap<String, String>>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(None))
}

fn load_blob() -> Result<HashMap<String, String>, keyring::Error> {
    match keyring::Entry::new(SERVICE, BLOB_KEY)?.get_password() {
        Ok(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        Err(keyring::Error::NoEntry) => Ok(HashMap::new()),
        Err(e) => Err(e),
    }
}

fn save_blob(map: &HashMap<String, String>) -> Result<(), keyring::Error> {
    let json = serde_json::to_string(map).unwrap_or_else(|_| "{}".into());
    keyring::Entry::new(SERVICE, BLOB_KEY)?.set_password(&json)
}

/// Runs `f` with the loaded blob (loading it on first use).
fn with_store<T>(
    f: impl FnOnce(&mut HashMap<String, String>) -> Result<T, keyring::Error>,
) -> Result<T, keyring::Error> {
    let mut guard = store().lock().unwrap();
    if guard.is_none() {
        *guard = Some(load_blob()?);
    }
    f(guard.as_mut().unwrap())
}

/// Migrates a pre-blob secret (its own keychain item, one prompt each) into
/// the blob, then removes the old item. Returns the value if it existed.
fn migrate_legacy(key: &str, map: &mut HashMap<String, String>) -> Option<String> {
    let entry = keyring::Entry::new(SERVICE, key).ok()?;
    let value = entry.get_password().ok()?;
    map.insert(key.to_string(), value.clone());
    let _ = save_blob(map);
    let _ = entry.delete_credential();
    Some(value)
}

/// Keys confirmed absent this launch, so misses don't re-query the keychain
/// on every 60 s sync tick.
fn misses() -> &'static Mutex<std::collections::HashSet<String>> {
    static MISSES: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    MISSES.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

pub fn get(key: &str) -> Result<Option<String>, keyring::Error> {
    if misses().lock().unwrap().contains(key) {
        return Ok(None);
    }
    with_store(|map| {
        if let Some(v) = map.get(key) {
            return Ok(Some(v.clone()));
        }
        let migrated = migrate_legacy(key, map);
        if migrated.is_none() {
            misses().lock().unwrap().insert(key.to_string());
        }
        Ok(migrated)
    })
}

pub fn set(key: &str, value: &str) -> Result<(), keyring::Error> {
    misses().lock().unwrap().remove(key);
    with_store(|map| {
        map.insert(key.to_string(), value.to_string());
        save_blob(map)
    })
}

pub fn delete(key: &str) -> Result<(), keyring::Error> {
    with_store(|map| {
        if map.remove(key).is_some() {
            save_blob(map)?;
        }
        // Also clear any pre-blob item so it can't resurface via migration.
        if let Ok(entry) = keyring::Entry::new(SERVICE, key) {
            let _ = entry.delete_credential();
        }
        Ok(())
    })
}
