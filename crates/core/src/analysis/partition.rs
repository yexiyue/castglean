use crate::{AnalysisError, ExpressionKind, Segment, SegmentId, SourceSnapshot};

/// Version of source partition rules and generated segment identities.
pub const SEGMENTATION_VERSION: u32 = 1;

/// Deterministic complete UTF-8 partition; quotes never assign semantic types.
pub fn partition_source(
    source: &SourceSnapshot,
    max_chars: usize,
) -> Result<Vec<Segment>, AnalysisError> {
    if max_chars == 0 {
        return Err(AnalysisError::InvalidOptions);
    }
    let mut boundaries = vec![0];
    let mut count = 0;
    let mut ascii_open = false;
    let mut characters = source.text().char_indices().peekable();
    while let Some((offset, ch)) = characters.next() {
        let opening = matches!(ch, '“' | '‘' | '「' | '『') || (ch == '"' && !ascii_open);
        let closing = matches!(ch, '”' | '’' | '」' | '』') || (ch == '"' && ascii_open);
        if opening || ch == '\n' {
            if boundaries.last() != Some(&offset) {
                boundaries.push(offset);
            }
            count = 0;
        }
        count += 1;
        let next_closes_quote = characters.peek().is_some_and(|(_, next)| {
            matches!(next, '”' | '’' | '」' | '』') || (*next == '"' && ascii_open)
        });
        let sentence_end = matches!(ch, '。' | '！' | '？' | '!' | '?' | ';' | '；');
        if closing
            || matches!(ch, '\n' | ':' | '：')
            || (sentence_end && !next_closes_quote)
            || count == max_chars
        {
            boundaries.push(offset + ch.len_utf8());
            count = 0;
        }
        if ch == '"' {
            ascii_open = !ascii_open;
        }
    }
    boundaries.push(source.text().len());
    boundaries.dedup();
    boundaries
        .windows(2)
        .map(|range| {
            Ok(Segment {
                id: SegmentId::new(format!(
                    "seg-v{SEGMENTATION_VERSION}-{}-{}-{}",
                    source.metadata().sha256,
                    range[0],
                    range[1]
                ))?,
                start: range[0],
                end: range[1],
                kind: ExpressionKind::Narration,
                attribution: None,
                extensions: Default::default(),
            })
        })
        .collect()
}

pub(super) fn windows(
    segments: &[Segment],
    source: &SourceSnapshot,
    max_chars: usize,
    max_segments: usize,
) -> Vec<std::ops::Range<usize>> {
    let mut result = Vec::new();
    let mut start = 0;
    let mut count = 0;
    for (index, segment) in segments.iter().enumerate() {
        let length = source.text()[segment.start..segment.end].chars().count();
        if count > 0 && (count + length > max_chars || index - start == max_segments) {
            result.push(start..index);
            start = index;
            count = 0;
        }
        count += length;
    }
    if start < segments.len() {
        result.push(start..segments.len());
    }
    result
}
