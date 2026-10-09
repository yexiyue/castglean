//! Window-local transport names, decoded before domain validation.
use super::{
    AnalysisSuggestion, CharacterReference, QuotationSuggestion, SuggestedAttribution,
    SuggestionIssue, SuggestionIssueCode,
};
use crate::{CharacterId, SegmentId};

pub(super) struct References {
    segments: Vec<SegmentId>,
    characters: Vec<CharacterId>,
}
fn index(value: &str, prefix: char) -> Option<usize> {
    let index = value.strip_prefix(prefix)?.parse::<usize>().ok()?;
    (value == format!("{prefix}{index}")).then_some(index)
}
impl References {
    pub(super) fn new(window: &super::window::WindowContext<'_, '_>) -> Self {
        Self {
            segments: window.segments[window.visible.clone()]
                .iter()
                .map(|s| s.id.clone())
                .collect(),
            characters: window
                .registry
                .characters
                .iter()
                .map(|c| c.id.clone())
                .collect(),
        }
    }
    fn segment(
        &self,
        wire: &SegmentId,
        code: SuggestionIssueCode,
        path: String,
    ) -> Result<SegmentId, SuggestionIssue> {
        index(wire.as_str(), 's')
            .and_then(|i| self.segments.get(i))
            .cloned()
            .ok_or_else(|| SuggestionIssue::new(code, path))
    }
    fn character(
        &self,
        reference: &mut CharacterReference,
        path: String,
    ) -> Result<(), SuggestionIssue> {
        if let CharacterReference::Existing(wire) = reference {
            *wire = index(wire.as_str(), 'c')
                .and_then(|i| self.characters.get(i))
                .cloned()
                .ok_or_else(|| SuggestionIssue::new(SuggestionIssueCode::UnknownIdentity, path))?;
        }
        Ok(())
    }
    fn evidence(
        &self,
        ids: &mut [SegmentId],
        quotes: &mut [QuotationSuggestion],
        path: &str,
    ) -> Result<(), SuggestionIssue> {
        for (i, id) in ids.iter_mut().enumerate() {
            *id = self.segment(
                id,
                SuggestionIssueCode::InvalidEvidence,
                format!("{path}/evidence_segment_ids/{i}"),
            )?;
        }
        for (i, quote) in quotes.iter_mut().enumerate() {
            quote.segment_id = self.segment(
                &quote.segment_id,
                SuggestionIssueCode::InvalidQuotation,
                format!("{path}/evidence_quotes/{i}"),
            )?;
        }
        Ok(())
    }
    pub(super) fn decode(
        &self,
        mut suggestion: AnalysisSuggestion,
    ) -> Result<AnalysisSuggestion, SuggestionIssue> {
        for (i, character) in suggestion.characters.iter_mut().enumerate() {
            self.evidence(
                &mut character.evidence_segment_ids,
                &mut character.evidence_quotes,
                &format!("/characters/{i}"),
            )?;
        }
        for (i, segment) in suggestion.segments.iter_mut().enumerate() {
            segment.segment_id = self.segment(
                &segment.segment_id,
                SuggestionIssueCode::OutsideTarget,
                format!("/segments/{i}/segment_id"),
            )?;
            let path = format!("/segments/{i}/attribution");
            match &mut segment.attribution {
                Some(SuggestedAttribution::Resolved {
                    character,
                    evidence_segment_ids,
                    evidence_quotes,
                }) => {
                    self.character(character, format!("{path}/character"))?;
                    self.evidence(evidence_segment_ids, evidence_quotes, &path)?;
                }
                Some(SuggestedAttribution::Ambiguous {
                    candidates,
                    evidence_segment_ids,
                    evidence_quotes,
                }) => {
                    for (i, candidate) in candidates.iter_mut().enumerate() {
                        self.character(candidate, format!("{path}/candidates/{i}"))?;
                    }
                    self.evidence(evidence_segment_ids, evidence_quotes, &path)?;
                }
                Some(SuggestedAttribution::Unknown {
                    evidence_segment_ids,
                    evidence_quotes,
                }) => {
                    self.evidence(evidence_segment_ids, evidence_quotes, &path)?;
                }
                None => {}
            }
        }
        Ok(suggestion)
    }
    /// Public errors keep domain IDs; only trusted IDs are exposed to repair as handles.
    pub(super) fn feedback(&self, issue: &SuggestionIssue) -> SuggestionIssue {
        let mut feedback = SuggestionIssue::new(issue.code(), issue.path());
        if let Some(i) = issue
            .segment_id()
            .and_then(|id| self.segments.iter().position(|s| s == id))
        {
            feedback =
                feedback.for_segment(&SegmentId::new(format!("s{i}")).expect("application handle"));
        }
        feedback.with_missing(
            issue
                .missing_segment_ids()
                .iter()
                .filter_map(|id| self.segments.iter().position(|s| s == id))
                .map(|i| SegmentId::new(format!("s{i}")).expect("application handle"))
                .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn refs() -> References {
        References {
            segments: vec![
                SegmentId::new("real-segment-0").unwrap(),
                SegmentId::new("real-segment-1").unwrap(),
            ],
            characters: vec![CharacterId::new("real-character").unwrap()],
        }
    }
    fn candidate() -> serde_json::Value {
        json!({"characters":[{"temp_id":"c0","display_name":"甲","aliases":[],"evidence_segment_ids":["s0"],"evidence_quotes":[{"segment_id":"s0","quote":"甲"}]}],
        "segments":[{"segment_id":"s1","kind":"speech","attribution":{"status":"ambiguous","candidates":[{"scope":"existing","id":"c0"},{"scope":"new","id":"c0"}],"evidence_segment_ids":["s0","s1"],"evidence_quotes":[{"segment_id":"s0","quote":"甲"}]}}]})
    }
    #[test]
    fn restores_every_reference_without_conflating_namespaces() {
        let decoded = refs()
            .decode(serde_json::from_value(candidate()).unwrap())
            .unwrap();
        let v = serde_json::to_value(decoded).unwrap();
        assert_eq!(v["characters"][0]["temp_id"], "c0");
        assert_eq!(
            v["characters"][0]["evidence_segment_ids"][0],
            "real-segment-0"
        );
        assert_eq!(
            v["characters"][0]["evidence_quotes"][0]["segment_id"],
            "real-segment-0"
        );
        assert_eq!(v["segments"][0]["segment_id"], "real-segment-1");
        assert_eq!(
            v["segments"][0]["attribution"]["candidates"][0]["id"],
            "real-character"
        );
        assert_eq!(v["segments"][0]["attribution"]["candidates"][1]["id"], "c0");
        assert_eq!(
            v["segments"][0]["attribution"]["evidence_segment_ids"],
            json!(["real-segment-0", "real-segment-1"])
        );
        assert_eq!(
            v["segments"][0]["attribution"]["evidence_quotes"][0]["segment_id"],
            "real-segment-0"
        );
    }
    #[test]
    fn rejects_noncanonical_unsupplied_and_formal_ids_safely() {
        for value in [
            "s01",
            "s+1",
            "s-1",
            "s2",
            "s184467440737095516160",
            "real-segment-0",
            "c0",
            "private-invalid",
        ] {
            let mut v = candidate();
            v["segments"][0]["segment_id"] = json!(value);
            let issue = refs()
                .decode(serde_json::from_value(v).unwrap())
                .err()
                .unwrap();
            assert_eq!(issue.code(), SuggestionIssueCode::OutsideTarget);
            assert!(!serde_json::to_string(&issue).unwrap().contains(value));
        }
        for (path, code) in [
            (
                "/characters/0/evidence_segment_ids/0",
                SuggestionIssueCode::InvalidEvidence,
            ),
            (
                "/segments/0/attribution/evidence_quotes/0/segment_id",
                SuggestionIssueCode::InvalidQuotation,
            ),
            (
                "/segments/0/attribution/candidates/0/id",
                SuggestionIssueCode::UnknownIdentity,
            ),
        ] {
            let mut v = candidate();
            *v.pointer_mut(path).unwrap() = json!("private-invalid");
            let issue = refs()
                .decode(serde_json::from_value(v).unwrap())
                .err()
                .unwrap();
            assert_eq!(issue.code(), code);
            assert!(!format!("{issue:?}").contains("private-invalid"));
        }
    }
    #[test]
    fn repair_feedback_only_maps_trusted_visible_ids() {
        let issue = SuggestionIssue::new(SuggestionIssueCode::MissingTarget, "/segments")
            .for_segment(&SegmentId::new("real-segment-1").unwrap());
        assert_eq!(refs().feedback(&issue).segment_id().unwrap().as_str(), "s1");
        assert_eq!(issue.segment_id().unwrap().as_str(), "real-segment-1");
        let invisible = SuggestionIssue::new(SuggestionIssueCode::MissingTarget, "/segments")
            .for_segment(&SegmentId::new("other-window").unwrap());
        assert!(refs().feedback(&invisible).segment_id().is_none());
    }
}
