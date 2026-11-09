//! Explicit completed-phase checkpoint boundaries, revalidated against the source.
use super::dto::{Analysis, Source};
use super::*;

impl Draft {
    /// Creates an analysis draft; identities are never inferred by merging names.
    /// `aliases` is losslessly included in model context and frozen in checkpoints.
    pub fn analysis(
        source: &str,
        characters: Vec<CoreCharacter>,
        aliases: Value,
    ) -> Result<SharedDraft> {
        let state = InputState {
            source: Source {
                text: source.to_owned(),
                sha256: hash(source.as_bytes()),
            },
            characters,
            aliases,
            new_characters: vec![],
            evaluation_task: "analysis".into(),
            review_input: None,
        };
        let mut draft = Self::new(state, true)?;
        draft.enable_compact()?;
        Ok(Arc::new(Mutex::new(draft)))
    }

    /// Independent read-only review. Suggestions cannot change the supplied analysis.
    pub fn review(source: &str, analysis: ValidatedAnalysis) -> Result<SharedDraft> {
        let mut draft = Self::from_validated(source, analysis)?;
        draft.state.evaluation_task = "review".into();
        draft.allow_discovery = false;
        draft.state.review_input = Some(Analysis {
            segments: draft.segments.clone(),
        });
        draft.segments.clear();
        draft.done = false;
        Ok(Arc::new(Mutex::new(draft)))
    }

    /// Restore a completed analysis boundary, never an interrupted tool loop.
    pub fn restore_analysis(source: &str, analysis: ValidatedAnalysis) -> Result<SharedDraft> {
        Ok(Arc::new(Mutex::new(Self::from_validated(
            source, analysis,
        )?)))
    }

    fn from_validated(source: &str, analysis: ValidatedAnalysis) -> Result<Self> {
        ensure!(
            analysis.protocol_version == PROTOCOL_VERSION,
            "checkpoint_protocol"
        );
        ensure!(
            analysis.prompt_hash == hash(prompt().as_bytes()),
            "checkpoint_prompt"
        );
        ensure!(
            analysis.source_hash == hash(source.as_bytes()),
            "checkpoint_source"
        );
        ensure!(analysis.revision > 0, "checkpoint_revision");
        let state = InputState {
            source: Source {
                text: source.into(),
                sha256: analysis.source_hash,
            },
            characters: analysis.characters,
            aliases: analysis.aliases,
            new_characters: analysis.new_characters,
            evaluation_task: "analysis".into(),
            review_input: None,
        };
        let mut draft = Self::new(state, true)?;
        draft.compact = true;
        draft.character_refs = analysis.character_refs;
        let known: BTreeSet<_> = draft
            .state
            .characters
            .iter()
            .map(|c| c.id.as_str())
            .collect();
        for (reference, target) in &draft.character_refs {
            ensure!(
                !reference.is_empty()
                    && !["narrator", "unknown", "ambiguous"].contains(&reference.as_str())
                    && known.contains(target.as_str())
                    && (!known.contains(reference.as_str()) || reference == target),
                "checkpoint_refs"
            );
        }
        let mut ids = BTreeSet::new();
        for c in &draft.state.new_characters {
            ensure!(
                ids.insert(&c.id)
                    && c.reference
                        .strip_prefix("new:")
                        .is_some_and(|r| !r.is_empty()
                            && r.len() <= 128
                            && r.bytes()
                                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b)))
                    && c.id == candidate_id(&draft.state.source.sha256, &c.reference)
                    && draft.character_refs.get(&c.reference) == Some(&c.id)
                    && draft
                        .state
                        .characters
                        .iter()
                        .any(|known| known.id == c.id && known.name == c.name)
                    && !c.evidence.is_empty()
                    && c.evidence.iter().all(|r| draft.state.range(*r)),
                "checkpoint_characters"
            );
        }
        draft.state.validate_segments(
            &analysis.segments,
            Range {
                start: 0,
                end: source.len(),
            },
        )?;
        draft.segments = analysis.segments;
        draft.revision = analysis.revision;
        draft.piece_revisions.fill(draft.revision);
        draft.done = true;
        Ok(draft)
    }

    /// Available only after successful analysis completion, never during review.
    pub fn result(&self) -> Result<ValidatedAnalysis> {
        ensure!(
            self.finished() && self.state.evaluation_task == "analysis",
            "analysis_not_finished"
        );
        self.state.validate_segments(
            &self.segments,
            Range {
                start: 0,
                end: self.state.source.text.len(),
            },
        )?;
        Ok(ValidatedAnalysis {
            protocol_version: PROTOCOL_VERSION.into(),
            prompt_hash: hash(prompt().as_bytes()),
            source_hash: self.state.source.sha256.clone(),
            characters: self.state.characters.clone(),
            new_characters: self.state.new_characters.clone(),
            character_refs: self.character_refs.clone(),
            aliases: self.state.aliases.clone(),
            segments: self.segments.clone(),
            revision: self.revision,
        })
    }
}
