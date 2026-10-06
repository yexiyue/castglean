//! JSON stream helpers and draft Schema export. No filesystem policy or commits.

use crate::{ChapterAnnotations, CharacterRegistry, Error};
use schemars::{Schema, schema_for};
use serde::{Serialize, de::DeserializeOwned};
use std::io::{Read, Write};

/// Decode a strict DTO; semantic/source validation remains a separate step.
pub fn read_json<T: DeserializeOwned>(reader: impl Read) -> Result<T, Error> {
    Ok(serde_json::from_reader(reader)?)
}

/// Write pretty JSON to a caller-provided stream without choosing a file path.
pub fn write_json<T: Serialize>(writer: impl Write, value: &T) -> Result<(), Error> {
    Ok(serde_json::to_writer_pretty(writer, value)?)
}

/// Generate the draft character registry's structural JSON Schema.
pub fn characters_schema() -> Schema {
    schema_for!(CharacterRegistry)
}

/// Generate the draft chapter annotation's structural JSON Schema.
pub fn annotations_schema() -> Schema {
    schema_for!(ChapterAnnotations)
}
