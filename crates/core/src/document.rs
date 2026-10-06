//! Immutable source snapshots and validated UTF-8 byte coordinates.

use crate::Error;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Supported newline normalization version (CRLF/CR to LF only).
pub const NORMALIZATION_VERSION: u32 = 1;

/// Coordinate unit used by draft annotations.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum OffsetUnit {
    /// Zero-based UTF-8 byte offsets, with exclusive end.
    Utf8Byte,
}

/// Untrusted source metadata stored with chapter annotations.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SourceMetadata {
    /// SHA-256 of the saved normalized UTF-8 bytes.
    #[schemars(pattern(r"^[0-9a-f]{64}$"))]
    pub sha256: String,
    /// SHA-256 of the original imported UTF-8 bytes, before normalization.
    #[schemars(pattern(r"^[0-9a-f]{64}$"))]
    pub import_sha256: String,
    /// Normalization protocol; currently only 1 is supported.
    #[schemars(range(min = 1, max = 1))]
    pub normalization_version: u32,
    /// Byte coordinate convention.
    pub offset_unit: OffsetUnit,
}

/// Owned immutable normalized text, with verified snapshot metadata.
///
/// ```
/// use castglean_core::{ByteRange, SourceSnapshot};
/// let source = SourceSnapshot::import("张三\r\n🙂");
/// assert_eq!(source.text(), "张三\n🙂");
/// let range = ByteRange::new(&source, 7, 11)?;
/// assert_eq!(source.slice(range)?, "🙂");
/// # Ok::<(), castglean_core::Error>(())
/// ```
#[derive(Clone, Debug)]
pub struct SourceSnapshot {
    text: String,
    metadata: SourceMetadata,
}

impl SourceSnapshot {
    /// Import UTF-8 text, changing only CRLF and lone CR into LF.
    pub fn import(input: &str) -> Self {
        let text = input.replace("\r\n", "\n").replace('\r', "\n");
        let metadata = SourceMetadata {
            sha256: sha256(&text),
            import_sha256: sha256(input),
            normalization_version: NORMALIZATION_VERSION,
            offset_unit: OffsetUnit::Utf8Byte,
        };
        Self { text, metadata }
    }

    /// Load an already normalized snapshot; never normalize stale annotations.
    ///
    /// The import digest is syntax-checked provenance. Original imported bytes
    /// are required to independently verify that digest.
    pub fn from_saved(text: String, metadata: SourceMetadata) -> Result<Self, Error> {
        if metadata.normalization_version != NORMALIZATION_VERSION {
            return Err(Error::invalid(
                "source.normalization_version",
                "unsupported version",
            ));
        }
        for (field, hash) in [
            ("sha256", &metadata.sha256),
            ("import_sha256", &metadata.import_sha256),
        ] {
            if hash.len() != 64
                || !hash
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err(Error::invalid(
                    format!("source.{field}"),
                    "expected lowercase SHA-256 hex",
                ));
            }
        }
        if text.contains('\r') {
            return Err(Error::invalid(
                "source",
                "saved snapshot must use LF newlines",
            ));
        }
        if sha256(&text) != metadata.sha256 {
            return Err(Error::invalid("source.sha256", "snapshot digest mismatch"));
        }
        Ok(Self { text, metadata })
    }

    /// Exact normalized source text, including whitespace.
    pub fn text(&self) -> &str {
        &self.text
    }

    /// Metadata tied to this snapshot.
    pub fn metadata(&self) -> &SourceMetadata {
        &self.metadata
    }

    /// Slice a checked range, rechecking it against this particular snapshot.
    pub fn slice(&self, range: ByteRange) -> Result<&str, Error> {
        ByteRange::new(self, range.start, range.end)?;
        Ok(&self.text[range.start..range.end])
    }
}

/// Nonempty half-open range validated against a source's UTF-8 boundaries.
///
/// A range does not identify a source; use `SourceSnapshot::slice` to check it
/// against another snapshot. Annotations additionally bind the source digest.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ByteRange {
    start: usize,
    end: usize,
}

impl ByteRange {
    /// Check bounds, nonempty order and Unicode character boundaries.
    pub fn new(source: &SourceSnapshot, start: usize, end: usize) -> Result<Self, Error> {
        let text = source.text();
        if start >= end
            || end > text.len()
            || !text.is_char_boundary(start)
            || !text.is_char_boundary(end)
        {
            return Err(Error::invalid(
                "range",
                format!(
                    "invalid UTF-8 byte range [{start}, {end}) for {} bytes",
                    text.len()
                ),
            ));
        }
        Ok(Self { start, end })
    }
    /// Inclusive starting byte offset.
    pub fn start(self) -> usize {
        self.start
    }
    /// Exclusive ending byte offset.
    pub fn end(self) -> usize {
        self.end
    }
}

fn sha256(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_preserves_unicode_and_whitespace() {
        let input = " \u{feff}张🙂e\u{301}\r\n\r尾 \n";
        let source = SourceSnapshot::import(input);
        assert_eq!(source.text(), " \u{feff}张🙂e\u{301}\n\n尾 \n");
        assert_eq!(source.metadata().import_sha256, sha256(input));
        assert_eq!(source.metadata().sha256, sha256(source.text()));
        assert_ne!(source.metadata().sha256, source.metadata().import_sha256);
    }

    #[test]
    fn digest_has_known_value_and_saved_text_is_verified() {
        let source = SourceSnapshot::import("张三说：“走吧。”");
        assert_eq!(
            source.metadata().sha256,
            "693d2f4dc01c19056a2dbf0fddf40a6c5c64f7690d0ba336727eb7c884a7a20f"
        );
        assert!(
            SourceSnapshot::from_saved(source.text().into(), source.metadata().clone()).is_ok()
        );
        assert!(SourceSnapshot::from_saved("改了".into(), source.metadata().clone()).is_err());
        let mut metadata = source.metadata().clone();
        metadata.normalization_version = 2;
        assert!(SourceSnapshot::from_saved(source.text().into(), metadata).is_err());
        let mut metadata = source.metadata().clone();
        metadata.import_sha256 = "secret".into();
        assert!(SourceSnapshot::from_saved(source.text().into(), metadata).is_err());
        let raw = "\r\n";
        let mut metadata = SourceSnapshot::import(raw).metadata().clone();
        metadata.sha256 = sha256(raw);
        assert!(SourceSnapshot::from_saved(raw.into(), metadata).is_err());
    }

    #[test]
    fn ranges_reject_mid_codepoint_empty_reversed_and_out_of_bounds() {
        let source = SourceSnapshot::import("中🙂e\u{301}");
        for (start, end) in [
            (1, 3),
            (3, 6),
            (7, 9),
            (0, 0),
            (7, 3),
            (0, 11),
            (usize::MAX, usize::MAX),
        ] {
            assert!(ByteRange::new(&source, start, end).is_err());
        }
        let range = ByteRange::new(&source, 3, 7).unwrap();
        assert_eq!(source.slice(range).unwrap(), "🙂");
        assert!(SourceSnapshot::import("x").slice(range).is_err());
        assert!(ByteRange::new(&SourceSnapshot::import(""), 0, 0).is_err());
    }
}
