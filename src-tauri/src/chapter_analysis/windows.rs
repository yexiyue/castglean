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

/// C7 uses compact runs rather than per-character JSON coordinates. Unknown
/// provider capacity is not silently replaced with an invented 8k limit.
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
    // Conservative estimates, not an assertion of actual tokenizer capacity.
    // Reserve room for source, one tool response and the next model turn.
    let mut scalars = match context_window {
        Some(n) => {
            (n as usize)
                .checked_sub(context_bytes.saturating_add(4096))
                .ok_or(AnalysisError::CapacityExceeded)?
                / 4
        }
        None => text[full.start as usize..full.end as usize].chars().count(),
    };
    if let Some(n) = output_tokens {
        scalars = scalars.min(n as usize * 3);
    }
    if scalars < 16 {
        return Err(AnalysisError::CapacityExceeded);
    }
    let anchors = source::anchors(text, &full, scalars.min(512))?;
    let mut ranges = Vec::new();
    let mut start = binding.start;
    let mut count = 0;
    for a in &anchors {
        let n = a.text.chars().count();
        if count > 0 && count + n > scalars {
            ranges.push(ByteRange {
                start,
                end: a.start,
            });
            start = a.start;
            count = 0;
        }
        count += n;
    }
    ranges.push(ByteRange {
        start,
        end: binding.end,
    });
    ranges
        .into_iter()
        .enumerate()
        .map(|(i, owned)| {
            // No overlap is annotated; adjacent context is explicitly read-only.
            let mut a = (owned.start as usize)
                .saturating_sub(512)
                .max(binding.start as usize);
            let mut b = (owned.end as usize)
                .saturating_add(512)
                .min(binding.end as usize);
            while !text.is_char_boundary(a) {
                a += 1;
            }
            while !text.is_char_boundary(b) {
                b -= 1;
            }
            Ok(Window {
                id: format!("c7w{i}"),
                context: ByteRange {
                    start: a as u32,
                    end: b as u32,
                },
                anchors: source::anchors(text, &owned, 512)?,
                owned,
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
    fn c7_unknown_capacity_does_not_invent_an_8k_window() {
        let text = "甲说：“好。”\n".repeat(1200);
        let binding = SourceBinding {
            project_id: "p".into(),
            chapter_id: "c".into(),
            source_id: "s".into(),
            sha256: crate::project::hash(text.as_bytes()),
            start: 0,
            end: text.len() as u32,
        };
        for capacity in [None, Some(256000)] {
            let plans = plan(&text, &binding, capacity, None, 400).unwrap();
            assert_eq!(plans.len(), 1);
            assert_eq!(plans[0].owned.end, text.len() as u32);
        }
        let plans = plan(&text, &binding, Some(6000), None, 400).unwrap();
        assert!(plans.len() > 1);
        let bytes = plans
            .iter()
            .map(|p| &text[p.owned.start as usize..p.owned.end as usize])
            .collect::<String>();
        assert_eq!(bytes, text);
    }
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
            if capacity.is_some() {
                assert!(windows.len() > 1);
            }
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
                    text[w.owned.start as usize..w.owned.end as usize]
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
