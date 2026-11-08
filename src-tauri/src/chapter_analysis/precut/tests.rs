use super::*;

fn binding(text: &str, start: usize, end: usize) -> SourceBinding {
    SourceBinding {
        project_id: "p".into(),
        chapter_id: "chapter".into(),
        source_id: "source".into(),
        sha256: crate::project::hash(text.as_bytes()),
        start: start as u32,
        end: end as u32,
    }
}

#[test]
fn exact_utf8_bom_mixed_newlines_and_absolute_chapter_range() {
    let prefix = "前章\r\n";
    let chapter = "\u{feff}甲🙂：e\u{301}！\r\n\r乙。\n　\n尾";
    let text = format!("{prefix}{chapter}后章");
    let b = binding(&text, prefix.len(), prefix.len() + chapter.len());
    let pieces = partition(&text, &b).unwrap();
    assert_eq!(
        pieces.iter().map(|p| p.text.as_str()).collect::<String>(),
        chapter
    );
    let mut next = b.start;
    for (i, p) in pieces.iter().enumerate() {
        assert_eq!(p.id, format!("s{i}"));
        assert_eq!(p.range.start, next);
        assert_eq!(
            text.get(p.range.start as usize..p.range.end as usize),
            Some(p.text.as_str())
        );
        next = p.range.end;
    }
    assert_eq!(next, b.end);
    assert_eq!(partition(&text, &b).unwrap(), pieces);
}

#[test]
fn nested_titles_share_outer_utterance_without_classifying_speech() {
    let text = "甲说：“听说‘铁手’和「剑客」来了。走吧！”乙离开。";
    let pieces = partition(text, &binding(text, 0, text.len())).unwrap();
    let outer = pieces.iter().find(|p| p.text.contains('“')).unwrap();
    let nested = pieces.iter().find(|p| p.text.contains("铁手")).unwrap();
    assert_eq!(nested.quote_depth, 2);
    assert_eq!(nested.utterance, Some(outer.id.clone()));
    let continuation = pieces.iter().find(|p| p.text.contains("走吧")).unwrap();
    assert_eq!(continuation.utterance, outer.utterance);
    assert_eq!(continuation.quote_depth, 1);
    assert_eq!(pieces.last().unwrap().utterance, None);
}

#[test]
fn whitespace_attaches_to_neighbors_and_crlf_is_not_lost() {
    let text = " \r\n“甲。”\r\n　乙。\n\n";
    let pieces = partition(text, &binding(text, 0, text.len())).unwrap();
    assert!(pieces.iter().all(|p| !p.text.trim().is_empty()));
    assert!(pieces[0].text.starts_with(" \r\n"));
    assert_eq!(
        pieces.iter().map(|p| p.text.as_str()).collect::<String>(),
        text
    );
    assert!(pieces.iter().all(|p| !p.text.ends_with('\r')));
}

#[test]
fn scalar_limit_never_splits_unicode_or_loses_unclosed_quote_context() {
    let text = format!("“{}", "🙂e\u{301}".repeat(170));
    let pieces = partition(&text, &binding(&text, 0, text.len())).unwrap();
    assert!(pieces.iter().all(|p| p.text.chars().count() <= 160));
    assert!(
        pieces
            .iter()
            .all(|p| p.quote_depth == 1 && p.utterance.as_deref() == Some("s0"))
    );
    assert_eq!(
        pieces.iter().map(|p| p.text.as_str()).collect::<String>(),
        text
    );
}

#[test]
fn apostrophes_inside_english_words_do_not_open_quotes() {
    let text = "Don't panic. It’s fine.";
    assert!(
        partition(text, &binding(text, 0, text.len()))
            .unwrap()
            .iter()
            .all(|p| p.quote_depth == 0)
    );
}

#[test]
fn mismatched_quote_does_not_pop_outer_context() {
    let text = "“甲』。乙”尾";
    let pieces = partition(text, &binding(text, 0, text.len())).unwrap();
    assert!(
        pieces
            .iter()
            .filter(|p| p.text.contains('乙'))
            .all(|p| p.quote_depth == 1)
    );
    assert_eq!(pieces.last().unwrap().quote_depth, 0);
}

#[test]
fn invalid_utf8_boundaries_empty_ranges_and_changed_sources_are_rejected() {
    let text = "甲🙂乙";
    for (start, end) in [(1, text.len()), (0, 4), (3, 3), (0, text.len() + 1)] {
        assert_eq!(
            partition(text, &binding(text, start, end)).unwrap_err(),
            AnalysisError::InvalidData
        );
    }
    let mut b = binding(text, 0, text.len());
    b.sha256 = "changed".into();
    assert_eq!(
        partition(text, &b).unwrap_err(),
        AnalysisError::SourceChanged
    );
}

#[test]
fn delimiter_and_whitespace_combinations_always_partition_every_byte() {
    let atoms = [
        "甲🙂", "\r\n", "\u{feff}", "　", "“", "”", "‘", "’", "。", "\n", "'", "a",
    ];
    for a in atoms {
        for b in atoms {
            for c in atoms {
                let text = format!("{a}{b}{c}");
                let pieces = partition(&text, &binding(&text, 0, text.len())).unwrap();
                let mut next = 0;
                for piece in &pieces {
                    assert_eq!(piece.range.start, next, "{text:?}");
                    assert_eq!(
                        text.get(piece.range.start as usize..piece.range.end as usize),
                        Some(piece.text.as_str())
                    );
                    if let Some(id) = &piece.utterance {
                        assert!(
                            pieces.iter().any(|p| &p.id == id && p.quote_depth > 0),
                            "{text:?}"
                        );
                    }
                    next = piece.range.end;
                }
                assert_eq!(next as usize, text.len(), "{text:?}");
            }
        }
    }
}
