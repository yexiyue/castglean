//! Exact source location and closed-set validation of the reserved evidence extension.
use super::{AnalysisInput, QuotationSuggestion, SuggestionIssue, SuggestionIssueCode};
use crate::{ChapterInput, Error, EvidenceRef, Extensions, Segment, SegmentId};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, ops::Range};

const KEY: &str = "castglean.quotation_evidence";
const MAX_QUOTES: usize = 8;
const MAX_CHARS: usize = 256;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct QuotationEvidence {
    version: u32,
    quotes: Vec<LocatedQuotation>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LocatedQuotation {
    chapter_id: crate::ChapterId,
    source_sha256: String,
    segment_id: SegmentId,
    start: usize,
    end: usize,
    quote: String,
}

fn valid_text(text: &str) -> bool {
    !text.trim().is_empty() && text.chars().take(MAX_CHARS + 1).count() <= MAX_CHARS
}

/// Unlike match_indices, this detects overlapping occurrences too.
fn unique_offset(text: &str, quote: &str) -> Result<usize, SuggestionIssueCode> {
    let mut offsets = text
        .char_indices()
        .filter_map(|(offset, _)| text[offset..].starts_with(quote).then_some(offset));
    let first = offsets
        .next()
        .ok_or(SuggestionIssueCode::QuotationNotFound)?;
    if offsets.next().is_some() {
        return Err(SuggestionIssueCode::QuotationNotUnique);
    }
    Ok(first)
}

pub(super) struct QuotationContext<'a, 'source> {
    pub input: &'a AnalysisInput<'source>,
    pub segments: &'a [Segment],
    pub visible: &'a Range<usize>,
}
impl QuotationContext<'_, '_> {
    pub(super) fn locate(
        &self,
        quotes: &[QuotationSuggestion],
        evidence: &[SegmentId],
        required: bool,
        path: &str,
    ) -> Result<Extensions, SuggestionIssue> {
        let issue = |code| SuggestionIssue::new(code, path);
        if required && quotes.is_empty() {
            return Err(issue(SuggestionIssueCode::MissingQuotation));
        }
        if quotes.len() > MAX_QUOTES {
            return Err(issue(SuggestionIssueCode::InvalidQuotation));
        }
        let mut seen = HashSet::new();
        let mut located = Vec::new();
        for (position, item) in quotes.iter().enumerate() {
            let path = format!("{path}/{position}");
            let issue = |code| SuggestionIssue::new(code, &path);
            if !valid_text(&item.quote)
                || !evidence.contains(&item.segment_id)
                || !seen.insert((&item.segment_id, &item.quote))
            {
                return Err(issue(SuggestionIssueCode::InvalidQuotation));
            }
            let segment = self.segments[self.visible.clone()]
                .iter()
                .find(|segment| segment.id == item.segment_id)
                .ok_or_else(|| issue(SuggestionIssueCode::InvalidQuotation))?;
            let text = &self.input.source.text()[segment.start..segment.end];
            let offset = unique_offset(text, &item.quote)
                .map_err(|code| issue(code).for_segment(&segment.id))?;
            let start = segment.start + offset;
            located.push(LocatedQuotation {
                chapter_id: self.input.chapter_id.clone(),
                source_sha256: self.input.source.metadata().sha256.clone(),
                segment_id: segment.id.clone(),
                start,
                end: start + item.quote.len(),
                quote: item.quote.clone(),
            });
        }
        let mut extensions = Extensions::new();
        if !located.is_empty() {
            extensions.insert(
                KEY.into(),
                serde_json::to_value(QuotationEvidence {
                    version: 1,
                    quotes: located,
                })
                .expect("application-generated quotation evidence serializes"),
            );
        }
        Ok(extensions)
    }
}

/// Absence is compatible with legacy documents; presence is never blindly trusted.
pub(crate) fn check_saved_quotations(
    extensions: &Extensions,
    allowed: &[EvidenceRef],
    chapters: &[ChapterInput],
) -> Result<(), Error> {
    let Some(value) = extensions.get(KEY) else {
        return Ok(());
    };
    let invalid = || Error::invalid(KEY, "invalid source quotation evidence");
    let evidence: QuotationEvidence =
        serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    if evidence.version != 1 || evidence.quotes.is_empty() || evidence.quotes.len() > MAX_QUOTES {
        return Err(invalid());
    }
    let mut seen = HashSet::new();
    for item in evidence.quotes {
        if !valid_text(&item.quote)
            || !allowed
                .iter()
                .any(|r| r.chapter_id == item.chapter_id && r.segment_id == item.segment_id)
            || !seen.insert((
                item.chapter_id.clone(),
                item.segment_id.clone(),
                item.quote.clone(),
            ))
        {
            return Err(invalid());
        }
        let chapter = chapters
            .iter()
            .find(|ch| ch.annotations.chapter_id == item.chapter_id)
            .ok_or_else(invalid)?;
        let segment = chapter
            .annotations
            .segments
            .iter()
            .find(|s| s.id == item.segment_id)
            .ok_or_else(invalid)?;
        if item.source_sha256 != chapter.source.metadata().sha256
            || item.start < segment.start
            || item.end > segment.end
            || item.start >= item.end
            || chapter.source.text().get(item.start..item.end) != Some(item.quote.as_str())
        {
            return Err(invalid());
        }
        let text = &chapter.source.text()[segment.start..segment.end];
        if unique_offset(text, &item.quote).ok() != Some(item.start - segment.start) {
            return Err(invalid());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn overlapping_and_unicode_matches() {
        assert_eq!(
            unique_offset("哈哈哈", "哈哈"),
            Err(SuggestionIssueCode::QuotationNotUnique)
        );
        assert_eq!(unique_offset("🙂张三说：", "张三说"), Ok(4));
        assert_eq!(
            unique_offset("甲乙", "甲丙"),
            Err(SuggestionIssueCode::QuotationNotFound)
        );
        assert!(valid_text(&"🙂".repeat(256)));
        assert!(!valid_text(&"🙂".repeat(257)));
        assert!(!valid_text(" \n"));
    }
}
