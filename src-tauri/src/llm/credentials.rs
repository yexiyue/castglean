//! The only boundary that can read secrets. Errors never retain platform diagnostics.
use super::types::LlmError;

pub(super) trait Credentials: Send + Sync {
    fn get(&self, reference: &str) -> Result<String, LlmError>;
    fn set(&self, reference: &str, secret: &str) -> Result<(), LlmError>;
    fn delete(&self, reference: &str) -> Result<(), LlmError>;
}

pub(super) struct SystemCredentials;

fn entry(reference: &str) -> Result<keyring::Entry, LlmError> {
    keyring::Entry::new("app.castglean.llm", reference).map_err(|_| LlmError::CredentialUnavailable)
}

impl Credentials for SystemCredentials {
    fn get(&self, reference: &str) -> Result<String, LlmError> {
        entry(reference)?
            .get_password()
            .map_err(|_| LlmError::CredentialUnavailable)
    }

    fn set(&self, reference: &str, secret: &str) -> Result<(), LlmError> {
        entry(reference)?
            .set_password(secret)
            .map_err(|_| LlmError::CredentialUnavailable)
    }

    fn delete(&self, reference: &str) -> Result<(), LlmError> {
        match entry(reference)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(LlmError::CredentialUnavailable),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "writes and removes a unique test entry in the platform credential store"]
    fn native_vault_roundtrip_replaces_and_removes_only_its_own_entry() {
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = SystemCredentials.delete(&self.0);
            }
        }
        let reference = Cleanup(uuid::Uuid::new_v4().to_string());
        SystemCredentials
            .set(&reference.0, "first-fixture-value")
            .unwrap();
        assert_eq!(
            SystemCredentials.get(&reference.0).unwrap(),
            "first-fixture-value"
        );
        SystemCredentials
            .set(&reference.0, "second-fixture-value")
            .unwrap();
        assert_eq!(
            SystemCredentials.get(&reference.0).unwrap(),
            "second-fixture-value"
        );
        SystemCredentials.delete(&reference.0).unwrap();
        assert_eq!(
            SystemCredentials.get(&reference.0),
            Err(LlmError::CredentialUnavailable)
        );
        SystemCredentials.delete(&reference.0).unwrap();
    }
}
