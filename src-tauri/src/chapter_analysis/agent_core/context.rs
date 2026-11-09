//! C7 lossless compact context projection for analysis and independent review.
use super::*;

/// Select the same registered identity for context rows and review speaker enums.
pub(super) fn identity(draft: &Draft, id: &str) -> String {
    if matches!(id, "unknown" | "narrator") {
        return id.to_owned();
    }
    let canonical = draft.character_refs.get(id).map_or(id, String::as_str);
    draft
        .character_refs
        .iter()
        .filter(|(_, target)| target.as_str() == canonical)
        .filter_map(|(reference, _)| {
            let rank = if reference.starts_with("new:") {
                0
            } else if reference
                .strip_prefix('c')
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
            {
                1
            } else {
                return None;
            };
            Some((rank, reference.as_str()))
        })
        .min()
        .map_or(canonical, |(_, reference)| reference)
        .to_owned()
}

/// Project validated draft data without coordinates, duplicate source, or gold.
pub(super) fn input(draft: &Draft) -> Value {
    let characters: Vec<_> = draft
        .state
        .characters
        .iter()
        .map(|character| {
            let mut row = json!(character.extra);
            row["id"] = json!(identity(draft, &character.id));
            row["name"] = json!(character.name);
            // Alias context keeps canonical IDs; make its binding explicit.
            row["canonicalId"] = json!(character.id);
            if let Some(description) = &character.description {
                row["description"] = json!(description);
            }
            row
        })
        .collect();
    let mut context = json!({
        "evaluationTask": draft.state.evaluation_task,
        "sourceHash": draft.state.source.sha256,
        "revision": draft.revision,
        "discoveryAllowed": draft.allow_discovery,
        "characters": characters,
    });
    context["aliases"] = draft.state.aliases.clone();
    context["pieceCount"] = json!(draft.pieces.len());
    context["lastPieceIndex"] = json!(draft.pieces.len().saturating_sub(1));
    if draft.state.evaluation_task == "review" {
        let annotations: Vec<_> = draft
            .state
            .review_input
            .iter()
            .flat_map(|candidate| &candidate.segments)
            .enumerate()
            .map(|(index, segment)| {
                let kind = match segment.kind.as_str() {
                    "narration" => "n",
                    "speech" => "s",
                    "thought" => "t",
                    other => other,
                };
                // Candidate boundaries need not coincide with analysis pieces.
                let text = draft
                    .state
                    .source
                    .text
                    .get(segment.start..segment.end)
                    .unwrap_or_default();
                let mut row = json!({
                    "id": format!("r{index}"),
                    "kind": kind,
                    "speaker": identity(draft, &segment.speaker),
                    "text": text,
                });
                if !segment.candidates.is_empty() {
                    row["candidates"] = json!(
                        segment
                            .candidates
                            .iter()
                            .map(|id| identity(draft, id))
                            .collect::<Vec<_>>()
                    );
                }
                row
            })
            .collect();
        context["annotations"] = json!(annotations);
    } else {
        context["pieces"] = json!(
            draft
                .pieces
                .iter()
                .enumerate()
                .map(|(index, piece)| json!([index, piece.text]))
                .collect::<Vec<_>>()
        );
    }
    context
}
