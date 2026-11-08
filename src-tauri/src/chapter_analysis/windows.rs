//! Full-chapter owned windows with read-only overlap. Capacity is per request, not per book.
use super::{
    source::{self, Anchor},
    types::*,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Window {
    pub id: String,
    pub owned: ByteRange,
    pub context: ByteRange,
    pub anchors: Vec<Anchor>,
}

pub(crate) fn plan(
    text: &str,
    binding: &SourceBinding,
    context_window: Option<u32>,
    output_tokens: Option<u32>,
    context_bytes: usize,
) -> Result<Vec<Window>, AnalysisError> {
    let full = ByteRange {
        start: binding.start,
        end: binding.end,
    };
    if !super::validation::range_valid(text, binding, &full) {
        return Err(AnalysisError::InvalidData);
    }
    // Token counts are estimates: reserve prompt/identity space and structural output.
    // Unknown limits deliberately use small windows, never pretend to know provider capacity.
    let budget = context_window.map_or(8192, |n| n as usize);
    let available = budget
        .checked_sub(context_bytes.saturating_add(2048))
        .ok_or(AnalysisError::CapacityExceeded)?;
    let mut scalars = available / 12;
    if let Some(output) = output_tokens {
        scalars = scalars.min(output as usize / 6);
    }
    if scalars < 16 {
        return Err(AnalysisError::CapacityExceeded);
    }
    let anchors = source::anchors(text, &full, scalars.min(512))?;
    let mut owned = Vec::new();
    let mut start = binding.start;
    let mut count = 0;
    for a in &anchors {
        let n = a.text.chars().count();
        if count > 0 && count + n > scalars {
            owned.push(ByteRange {
                start,
                end: a.start,
            });
            start = a.start;
            count = 0;
        }
        count += n;
    }
    owned.push(ByteRange {
        start,
        end: binding.end,
    });
    owned
        .into_iter()
        .enumerate()
        .map(|(index, owned)| {
            let mut start = (owned.start as usize)
                .saturating_sub(512)
                .max(binding.start as usize);
            let mut end = (owned.end as usize)
                .saturating_add(512)
                .min(binding.end as usize);
            while !text.is_char_boundary(start) {
                start += 1;
            }
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            let context = ByteRange {
                start: start as u32,
                end: end as u32,
            };
            // Owned boundaries remain anchors even when overlap starts inside an original line.
            let mut parts = Vec::new();
            for range in [
                ByteRange {
                    start: context.start,
                    end: owned.start,
                },
                owned.clone(),
                ByteRange {
                    start: owned.end,
                    end: context.end,
                },
            ] {
                if range.start < range.end {
                    parts.extend(source::anchors(text, &range, 512)?);
                }
            }
            Ok(Window {
                id: format!("w{index}"),
                owned,
                context,
                anchors: parts,
            })
        })
        .collect()
}

/// Persistence records ranges and an anchor digest, never another copy of source text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WindowIdentity {
    pub id: String,
    pub owned: ByteRange,
    pub context: ByteRange,
    pub anchor_hash: String,
}
pub(crate) fn identity(window: &Window) -> Result<WindowIdentity, AnalysisError> {
    Ok(WindowIdentity {
        id: window.id.clone(),
        owned: window.owned.clone(),
        context: window.context.clone(),
        anchor_hash: crate::project::hash(
            &serde_json::to_vec(&window.anchors).map_err(|_| AnalysisError::InvalidData)?,
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn long_single_line_and_overlap_cover_every_byte_once() {
        let text = format!("\u{feff}{}\r\n\n结束", "甲🙂e\u{301}".repeat(4000));
        let b = SourceBinding {
            project_id: "p".into(),
            chapter_id: "c".into(),
            source_id: "s".into(),
            sha256: crate::project::hash(text.as_bytes()),
            start: 0,
            end: text.len() as u32,
        };
        for capacity in [None, Some(6000), Some(32000)] {
            let windows = plan(&text, &b, capacity, Some(4096), 200).unwrap();
            assert!(windows.len() > 1);
            let mut end = 0;
            let mut rebuilt = String::new();
            for w in windows {
                assert_eq!(w.owned.start, end);
                assert!(w.context.start <= w.owned.start && w.context.end >= w.owned.end);
                rebuilt.push_str(&text[w.owned.start as usize..w.owned.end as usize]);
                assert_eq!(
                    w.anchors
                        .iter()
                        .map(|a| a.text.as_str())
                        .collect::<String>(),
                    text[w.context.start as usize..w.context.end as usize]
                );
                let persisted = serde_json::to_string(&identity(&w).unwrap()).unwrap();
                assert!(!persisted.contains("\"text\""));
                assert!(!persisted.contains("甲"));
                let mut changed = w.clone();
                changed.anchors[0].text.push('乙');
                assert_ne!(identity(&w).unwrap(), identity(&changed).unwrap());
                end = w.owned.end;
            }
            assert_eq!(rebuilt, text);
        }
        assert!(plan(&text, &b, Some(2048), None, 100).is_err());
    }
}
