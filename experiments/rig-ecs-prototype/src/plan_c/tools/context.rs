//! Opt-in C6 context projection; candidate validation belongs to the caller.
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
        .case
        .characters
        .iter()
        .map(|character| {
            let mut row = json!({
                "id": identity(draft, &character.id),
                "name": character.name,
            });
            if let Some(description) = &character.description {
                row["description"] = json!(description);
            }
            row
        })
        .collect();
    let mut context = json!({
        "evaluationTask": draft.case.evaluation_task,
        "sourceHash": draft.case.source.sha256,
        "revision": draft.revision,
        "discoveryAllowed": draft.allow_discovery,
        "characters": characters,
    });
    context["pieceCount"] = json!(draft.pieces.len());
    context["lastPieceIndex"] = json!(draft.pieces.len().saturating_sub(1));
    if draft.case.evaluation_task == "review" {
        let annotations: Vec<_> = draft
            .case
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
                    .case
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

#[cfg(test)]
mod tests {
    use super::*;

    fn analysis() -> Draft {
        let text = "𠮷说：“你好🙂。”\r\n\t她想，e\u{301}。  ";
        let case = serde_json::from_value(json!({
            "version": 1,
            "caseId": "compact-context",
            "evaluationTask": "analysis",
            "source": {"text": text, "sha256": hash(text.as_bytes())},
            "characters": [
                {"id": "canonical-a", "name": "同名", "description": "姐姐，认识𠮷。"},
                {"id": "canonical-b", "name": "同名", "description": "妹妹，尚未相识。"},
                {"id": "canonical-c", "name": "无描述"}
            ]
        }))
        .unwrap();
        let mut draft = Draft::new(case, true).unwrap();
        for (reference, canonical) in [
            ("c0", "canonical-a"),
            ("new:sister", "canonical-a"),
            ("c1", "canonical-b"),
        ] {
            draft
                .character_refs
                .insert(reference.into(), canonical.into());
        }
        draft.revision = 7;
        draft
    }

    fn review(analysis: &Draft) -> Draft {
        let mut case = analysis.case.clone();
        case.evaluation_task = "review".into();
        // Split inside the first analysis piece, after a supplementary scalar.
        let boundaries = [0, "𠮷".len(), "𠮷说".len(), case.source.text.len()];
        let segments = boundaries
            .windows(2)
            .zip([
                ("narration", "narrator"),
                ("speech", "canonical-a"),
                ("thought", "unknown"),
            ])
            .map(|(range, (kind, speaker))| Segment {
                start: range[0],
                end: range[1],
                kind: kind.into(),
                speaker: speaker.into(),
                evidence: vec![Range {
                    start: range[0],
                    end: range[1],
                }],
                candidates: if speaker == "unknown" {
                    vec!["canonical-a".into(), "canonical-b".into()]
                } else {
                    vec![]
                },
            })
            .collect();
        case.review_input = Some(crate::contract::Analysis { segments });
        let mut draft = Draft::new(case, false).unwrap();
        draft.inherit_character_refs(analysis).unwrap();
        draft
    }

    fn assert_no_private_fields(value: &Value) {
        match value {
            Value::Object(object) => {
                for (key, child) in object {
                    assert!(
                        ![
                            "start",
                            "end",
                            "evidence",
                            "source",
                            "gold",
                            "reviewGold",
                            "characterRefs",
                            "identityDiscoveryAllowed"
                        ]
                        .contains(&key.as_str())
                    );
                    assert_no_private_fields(child);
                }
            }
            Value::Array(array) => array.iter().for_each(assert_no_private_fields),
            _ => {}
        }
    }

    #[test]
    fn analysis_integer_pieces_reconstruct_exact_utf8_without_coordinates() {
        let draft = analysis();
        let context = input(&draft);
        let rows = context["pieces"].as_array().unwrap();
        let mut reconstructed = String::new();
        for (index, row) in rows.iter().enumerate() {
            assert_eq!(row.as_array().unwrap().len(), 2);
            assert_eq!(row[0], json!(index));
            assert_eq!(draft.pieces[index].id, format!("p{index}"));
            reconstructed.push_str(row[1].as_str().unwrap());
        }
        assert_eq!(reconstructed.as_bytes(), draft.case.source.text.as_bytes());
        assert_eq!(context["evaluationTask"], "analysis");
        assert_eq!(context["sourceHash"], draft.case.source.sha256);
        assert_eq!(context["revision"], 7);
        assert_eq!(context["discoveryAllowed"], true);
        assert!(context.get("annotations").is_none());
        assert_no_private_fields(&context);
    }

    #[test]
    fn characters_preserve_descriptions_and_distinct_same_name_identities() {
        let draft = analysis();
        for context in [input(&draft), input(&review(&draft))] {
            let characters = context["characters"].as_array().unwrap();
            assert_eq!(characters.len(), 3);
            assert_eq!(
                characters[0],
                json!({"id":"new:sister", "name":"同名", "description":"姐姐，认识𠮷。"})
            );
            assert_eq!(
                characters[1],
                json!({"id":"c1", "name":"同名", "description":"妹妹，尚未相识。"})
            );
            assert_eq!(characters[2], json!({"id":"canonical-c", "name":"无描述"}));
        }
    }

    #[test]
    fn review_slices_original_source_once_and_preserves_candidates_and_refs() {
        let analysis = analysis();
        let draft = review(&analysis);
        let original = serde_json::to_value(draft.segments()).unwrap();
        let context = input(&draft);
        assert!(context.get("pieces").is_none());
        assert_eq!(context["discoveryAllowed"], false);
        let rows = context["annotations"].as_array().unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(
            rows[0],
            json!({"id":"r0", "kind":"n", "speaker":"narrator", "text":"𠮷"})
        );
        assert_eq!(
            rows[1],
            json!({"id":"r1", "kind":"s", "speaker":"new:sister", "text":"说"})
        );
        assert_eq!(rows[2]["kind"], "t");
        assert_eq!(rows[2]["speaker"], "unknown");
        assert_eq!(rows[2]["candidates"], json!(["new:sister", "c1"]));
        let reconstructed: String = rows
            .iter()
            .map(|row| row["text"].as_str().unwrap())
            .collect();
        assert_eq!(reconstructed.as_bytes(), draft.case.source.text.as_bytes());
        let ids: BTreeSet<_> = context["characters"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["id"].as_str().unwrap())
            .collect();
        for row in rows {
            let speaker = row["speaker"].as_str().unwrap();
            assert!(matches!(speaker, "narrator" | "unknown") || ids.contains(speaker));
            if let Some(candidates) = row.get("candidates") {
                for candidate in candidates.as_array().unwrap() {
                    assert!(ids.contains(candidate.as_str().unwrap()));
                }
            }
        }
        assert_no_private_fields(&context);
        assert_eq!(serde_json::to_value(draft.segments()).unwrap(), original);
    }

    #[test]
    fn identity_prefers_registered_new_then_c_refs_and_preserves_reserved_ids() {
        let mut draft = analysis();
        assert_eq!(identity(&draft, "canonical-a"), "new:sister");
        assert_eq!(identity(&draft, "c0"), "new:sister");
        assert_eq!(identity(&draft, "new:sister"), "new:sister");
        assert_eq!(identity(&draft, "canonical-b"), "c1");
        assert_eq!(identity(&draft, "canonical-c"), "canonical-c");
        draft
            .character_refs
            .insert("new:reserved".into(), "unknown".into());
        assert_eq!(identity(&draft, "unknown"), "unknown");
        assert_eq!(identity(&draft, "narrator"), "narrator");
        draft.character_refs.remove("new:sister");
        assert_eq!(identity(&draft, "canonical-a"), "c0");
    }

    #[test]
    fn malformed_utf8_boundary_does_not_panic_in_projection() {
        let mut draft = review(&analysis());
        draft.case.review_input.as_mut().unwrap().segments[0].end = 1;
        assert_eq!(input(&draft)["annotations"][0]["text"], "");
    }
}
