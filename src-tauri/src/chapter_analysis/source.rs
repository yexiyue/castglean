//! Host-owned exact Unicode-scalar anchors; offsets are never model-computed bytes.
use super::types::{AnalysisError, ByteRange};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Anchor {
    pub id: String,
    pub line: u32,
    pub start: u32,
    pub text: String,
}

pub(crate) fn line_at(text: &str, byte: u32) -> u32 {
    crate::project::line_ranges(text).partition_point(|(_, end)| *end <= byte) as u32
}

pub(crate) fn anchors(
    text: &str,
    range: &ByteRange,
    max_scalars: usize,
) -> Result<Vec<Anchor>, AnalysisError> {
    if max_scalars == 0 || range.start >= range.end {
        return Err(AnalysisError::InvalidData);
    }
    let chapter = text
        .get(range.start as usize..range.end as usize)
        .ok_or(AnalysisError::InvalidData)?;
    let first_line = line_at(text, range.start);
    let mut offset = range.start;
    let mut result = Vec::new();
    for (line, (a, b)) in (first_line..).zip(crate::project::line_ranges(chapter)) {
        let exact_line = &chapter[a as usize..b as usize];
        let mut remaining = exact_line;
        while !remaining.is_empty() {
            let end = remaining
                .char_indices()
                .nth(max_scalars)
                .map_or(remaining.len(), |(i, _)| i);
            let chunk = &remaining[..end];
            result.push(Anchor {
                id: format!("a{offset}"),
                line,
                start: offset,
                text: chunk.into(),
            });
            offset += end as u32;
            remaining = &remaining[end..];
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn anchors_preserve_utf8_bytes_and_source_lines() {
        let text = "前文\n\u{feff}甲：‘你😀好’\r\n乙：e\u{301}！\n\n\r\n尾";
        let start = "前文\n".len() as u32;
        let list = anchors(
            text,
            &ByteRange {
                start,
                end: text.len() as u32,
            },
            4,
        )
        .unwrap();
        assert_eq!(
            list.iter().map(|a| a.text.as_str()).collect::<String>(),
            &text[start as usize..]
        );
        let mut offset = start;
        for anchor in &list {
            assert_eq!(anchor.start, offset);
            assert_eq!(anchor.line, line_at(text, offset));
            assert!(anchor.text.chars().count() <= 4);
            offset += anchor.text.len() as u32;
            assert!(text.is_char_boundary(offset as usize));
        }
        assert_eq!(offset as usize, text.len());
        assert_eq!(list[0].line, 1);
        assert!(anchors(text, &ByteRange { start: 1, end: 4 }, 4).is_err());
    }
}
