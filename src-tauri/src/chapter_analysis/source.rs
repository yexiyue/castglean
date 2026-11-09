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

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Position {
    pub anchor_id: String,
    pub scalar: u32,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ModelRange {
    pub start: Position,
    pub end: Position,
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
pub(crate) fn position(anchors: &[Anchor], pos: &Position) -> Result<u32, AnalysisError> {
    let a = anchors
        .iter()
        .find(|a| a.id == pos.anchor_id)
        .ok_or(AnalysisError::InvalidData)?;
    let scalar = pos.scalar as usize;
    let relative = if scalar == a.text.chars().count() {
        a.text.len()
    } else {
        a.text
            .char_indices()
            .nth(scalar)
            .ok_or(AnalysisError::InvalidData)?
            .0
    };
    a.start
        .checked_add(relative as u32)
        .ok_or(AnalysisError::InvalidData)
}

#[cfg(test)]
pub(crate) fn resolve(anchors: &[Anchor], range: &ModelRange) -> Result<ByteRange, AnalysisError> {
    let start = position(anchors, &range.start)?;
    let end = position(anchors, &range.end)?;
    if start >= end {
        return Err(AnalysisError::InvalidData);
    }
    Ok(ByteRange { start, end })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scalar_coordinates_roundtrip_exact_bytes_and_lines() {
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
        for a in &list {
            for scalar in 0..=a.text.chars().count() {
                let byte = position(
                    &list,
                    &Position {
                        anchor_id: a.id.clone(),
                        scalar: scalar as u32,
                    },
                )
                .unwrap();
                assert!(text.is_char_boundary(byte as usize));
                assert_eq!(
                    text[a.start as usize..byte as usize].chars().count(),
                    scalar
                );
            }
            assert!(
                position(
                    &list,
                    &Position {
                        anchor_id: a.id.clone(),
                        scalar: a.text.chars().count() as u32 + 1
                    }
                )
                .is_err()
            );
        }
        assert_eq!(list[0].line, 1);
        assert!(anchors(text, &ByteRange { start: 1, end: 4 }, 4).is_err());
    }
}
