//! Preserve original argument identity while making decode rejection observable.
use serde::Deserialize;
use serde_json::Value;

pub(crate) struct Invocation<A> {
    pub raw: Value,
    pub arguments: Result<A, ()>,
}
impl<'de, A: serde::de::DeserializeOwned> Deserialize<'de> for Invocation<A> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = Value::deserialize(deserializer)?;
        let arguments = serde_json::from_value(raw.clone()).map_err(|_| ());
        Ok(Self { raw, arguments })
    }
}

/// Missing optional fields use serde(default); explicitly present values must
/// decode as T, so null cannot silently become absence unless the DTO allows it.
pub(crate) fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}
