const SERVICE: &str = "com.eduardomontilva.fldsmdpr";

pub fn get(key: &str) -> Result<Option<String>, keyring::Error> {
    match keyring::Entry::new(SERVICE, key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn set(key: &str, value: &str) -> Result<(), keyring::Error> {
    keyring::Entry::new(SERVICE, key)?.set_password(value)
}

pub fn delete(key: &str) -> Result<(), keyring::Error> {
    match keyring::Entry::new(SERVICE, key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e),
    }
}
