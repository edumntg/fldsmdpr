use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

const SERVICE: &str = "com.eduardomontilva.fldsmdpr";

/// In-memory cache so the OS keychain is touched at most once per key per app
/// launch. Without this, adaptive polling reads every token every 60 s, which
/// makes macOS pop the "wants to access secrets" dialog constantly (and an
/// unsigned dev build re-prompts each rebuild). `None` = confirmed absent.
fn cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn read_keychain(key: &str) -> Result<Option<String>, keyring::Error> {
    match keyring::Entry::new(SERVICE, key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn get(key: &str) -> Result<Option<String>, keyring::Error> {
    if let Some(hit) = cache().lock().unwrap().get(key) {
        return Ok(hit.clone());
    }
    let value = read_keychain(key)?;
    cache()
        .lock()
        .unwrap()
        .insert(key.to_string(), value.clone());
    Ok(value)
}

pub fn set(key: &str, value: &str) -> Result<(), keyring::Error> {
    keyring::Entry::new(SERVICE, key)?.set_password(value)?;
    cache()
        .lock()
        .unwrap()
        .insert(key.to_string(), Some(value.to_string()));
    Ok(())
}

pub fn delete(key: &str) -> Result<(), keyring::Error> {
    let result = match keyring::Entry::new(SERVICE, key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e),
    };
    cache().lock().unwrap().insert(key.to_string(), None);
    result
}
