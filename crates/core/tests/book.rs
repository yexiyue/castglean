//! Ordered book state, optimistic edits, and model-independent correction protection.
use castglean_core::*;
use serde_json::{Value, json};
use std::sync::atomic::{AtomicUsize, Ordering};
struct Model {
    new: bool,
    blank: bool,
    calls: AtomicUsize,
}
impl Model {
    fn new(new: bool, blank: bool) -> Self {
        Self {
            new,
            blank,
            calls: AtomicUsize::new(0),
        }
    }
}
impl AnalysisModel for Model {
    async fn generate(&self, request: ModelRequest) -> Result<ModelResponse, ModelError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let p: Value = serde_json::from_str(&request.user).unwrap();
        let existing = p["characters"].as_array().unwrap();
        let new = !self.blank && (self.new || existing.is_empty());
        let reference = if new {
            json!({"scope":"new","id":"person"})
        } else {
            json!({"scope":"existing","id":existing.first().map(|c|c["id"].clone()).unwrap_or(Value::Null)})
        };
        let characters = if new {
            json!([{"temp_id":"person","display_name":"张三","aliases":[],"evidence_segment_ids":[p["segments"][0]["id"]]}])
        } else {
            json!([])
        };
        let segments: Vec<_> = p["segments"].as_array().unwrap().iter().filter(|s|s["target"]==true).map(|s| {
            if !self.blank && s["text"].as_str().unwrap().starts_with('“') {
                json!({"segment_id":s["id"],"kind":"speech","attribution":{"status":"resolved","character":reference,"evidence_segment_ids":[p["segments"][0]["id"]]}})
            } else { json!({"segment_id":s["id"],"kind":"narration","attribution":null}) }
        }).collect();
        Ok(ModelResponse {
            text: json!({"characters":characters,"segments":segments}).to_string(),
            truncated: false,
            usage: Default::default(),
        })
    }
}
fn request(state: &BookState, id: &str, text: &str, mode: BookAnalysisMode) -> BookAnalysisInput {
    BookAnalysisInput {
        chapter_id: ChapterId::new(id).unwrap(),
        source: SourceSnapshot::import(text),
        expected_revision: state.revision(),
        mode,
    }
}
async fn first() -> BookState {
    let empty = BookState::new(BookId::new("book").unwrap()).unwrap();
    empty
        .analyze(
            &Model::new(false, false),
            request(&empty, "z", "张三说：“走吧。”", BookAnalysisMode::Append),
            &AnalysisOptions::default(),
            &CancellationToken::new(),
        )
        .await
        .unwrap()
        .state
}
fn correction(
    state: &BookState,
    kind: ExpressionKind,
    attribution: Option<Attribution>,
) -> CorrectionBatch {
    let c = state.book().chapters().last().unwrap();
    let s = &c.annotations().segments[1];
    CorrectionBatch {
        book_id: state.book().registry().book_id.clone(),
        expected_revision: state.revision(),
        corrections: vec![Correction::Attribution {
            chapter_id: c.annotations().chapter_id.clone(),
            source_sha256: c.source().metadata().sha256.clone(),
            segment_id: s.id.clone(),
            expression_kind: kind,
            attribution,
        }],
    }
}
#[tokio::test]
async fn stable_identity_order_and_serialized_schema() {
    let a = first().await;
    let id = a.book().registry().characters[0].id.clone();
    let b = a
        .analyze(
            &Model::new(false, false),
            request(&a, "a", "张三说：“等等。”", BookAnalysisMode::Append),
            &AnalysisOptions::default(),
            &CancellationToken::new(),
        )
        .await
        .unwrap()
        .state;
    assert_eq!(b.revision(), a.revision() + 1);
    assert_eq!(b.book().registry().characters.len(), 1);
    assert_eq!(b.book().registry().characters[0].id, id);
    assert_eq!(
        b.book().chapters()[0].source().text(),
        a.book().chapters()[0].source().text()
    );
    assert_eq!(b.known_at(&id), Some(&ChapterId::new("z").unwrap()));
    assert_eq!(
        book_schema().to_value(),
        serde_json::from_str::<Value>(include_str!("../../../schemas/book.schema.json")).unwrap()
    );
    assert_eq!(
        corrections_schema().to_value(),
        serde_json::from_str::<Value>(include_str!("../../../schemas/corrections.schema.json"))
            .unwrap()
    );
    let batch = correction(&b, ExpressionKind::QuotedText, None);
    jsonschema::validate(
        &corrections_schema().to_value(),
        &serde_json::to_value(batch).unwrap(),
    )
    .unwrap();
    let document = b.document();
    let value = serde_json::to_value(&document).unwrap();
    jsonschema::validate(&schemars::schema_for!(BookDocument).to_value(), &value).unwrap();
    let loaded = BookState::from_document(serde_json::from_value(value).unwrap()).unwrap();
    assert_eq!(loaded.document(), document);
    assert!(
        loaded
            .book()
            .chapters()
            .iter()
            .all(|c| c.annotations().character_revision == b.revision())
    );
}
#[tokio::test]
async fn same_names_stay_separate_and_future_identity_is_rejected() {
    let a = first().await;
    let b = a
        .analyze(
            &Model::new(true, false),
            request(&a, "a", "另一个张三说：“等等。”", BookAnalysisMode::Append),
            &AnalysisOptions::default(),
            &CancellationToken::new(),
        )
        .await
        .unwrap()
        .state;
    assert_eq!(
        b.candidates("张三", &ChapterId::new("z").unwrap())
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        b.candidates("张三", &ChapterId::new("a").unwrap())
            .unwrap()
            .len(),
        2
    );
    assert_ne!(
        b.book().registry().characters[0].id,
        b.book().registry().characters[1].id
    );
    let mut doc = b.document();
    if let Some(Attribution::Resolved { character_id, .. }) =
        &mut doc.chapters[0].annotations.segments[1].attribution
    {
        *character_id = doc.registry.characters[1].id.clone();
    }
    assert!(matches!(
        BookState::from_document(doc),
        Err(BookError::Operation(
            "attribution references a future identity"
        ))
    ));
}
#[tokio::test]
async fn conflicts_overflow_and_invalid_reanalysis_make_no_requests() {
    let a = first().await;
    let model = Model::new(false, false);
    let mut r = request(&a, "a", "文本", BookAnalysisMode::Append);
    r.expected_revision = 1;
    assert!(matches!(
        a.analyze(
            &model,
            r,
            &AnalysisOptions::default(),
            &CancellationToken::new()
        )
        .await,
        Err(BookError::Revision { .. })
    ));
    for (id, text) in [("a", "文本"), ("z", "改文")] {
        assert!(
            a.analyze(
                &model,
                request(&a, id, text, BookAnalysisMode::ReanalyzeLast),
                &AnalysisOptions::default(),
                &CancellationToken::new()
            )
            .await
            .is_err()
        );
    }
    let options = AnalysisOptions {
        segment_chars: 1,
        ..Default::default()
    };
    assert!(
        a.analyze(
            &model,
            request(
                &a,
                "z",
                a.book().chapters()[0].source().text(),
                BookAnalysisMode::ReanalyzeLast
            ),
            &options,
            &CancellationToken::new()
        )
        .await
        .is_err()
    );
    let mut doc = a.document();
    doc.registry.revision = u64::MAX;
    for c in &mut doc.chapters {
        c.annotations.character_revision = u64::MAX;
    }
    doc.changes.clear();
    let max = BookState::from_document(doc).unwrap();
    assert!(matches!(
        max.analyze(
            &model,
            request(&max, "a", "文本", BookAnalysisMode::Append),
            &AnalysisOptions::default(),
            &CancellationToken::new()
        )
        .await,
        Err(BookError::RevisionOverflow)
    ));
    assert_eq!(model.calls.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn corrections_are_source_bound_and_atomic() {
    let a = first().await;
    let before = a.document();
    let unknown = Some(Attribution::Unknown {
        evidence_segment_ids: vec![],
        review_status: ReviewStatus::Unreviewed,
    });
    let mut batch = correction(&a, ExpressionKind::Speech, unknown.clone());
    batch.corrections.push(Correction::Aliases {
        character_id: a.book().registry().characters[0].id.clone(),
        aliases: vec!["虚构称呼".into()],
        evidence: vec![],
    });
    assert!(a.correct(batch).is_err());
    assert_eq!(a.document(), before);
    let mut batch = correction(&a, ExpressionKind::Speech, unknown.clone());
    if let Correction::Attribution { source_sha256, .. } = &mut batch.corrections[0] {
        *source_sha256 = "0".repeat(64);
    }
    assert!(a.correct(batch).is_err());
    let mut batch = correction(&a, ExpressionKind::Speech, unknown);
    batch.book_id = BookId::new("other").unwrap();
    assert!(a.correct(batch).is_err());
    let mut changed = before.clone();
    changed.chapters[0].text.push('改');
    assert!(BookState::from_document(changed).is_err());
}
#[tokio::test]
async fn unknown_and_non_dialogue_confirmations_survive_reanalysis() {
    let a = first().await;
    for (kind, attribution) in [
        (
            ExpressionKind::Speech,
            Some(Attribution::Unknown {
                evidence_segment_ids: vec![],
                review_status: ReviewStatus::Unreviewed,
            }),
        ),
        (ExpressionKind::QuotedText, None),
    ] {
        let human = a.correct(correction(&a, kind, attribution)).unwrap();
        let old = human.book().chapters()[0].annotations().segments[1].clone();
        let new = human
            .analyze(
                &Model::new(false, false),
                request(
                    &human,
                    "z",
                    human.book().chapters()[0].source().text(),
                    BookAnalysisMode::ReanalyzeLast,
                ),
                &AnalysisOptions::default(),
                &CancellationToken::new(),
            )
            .await
            .unwrap()
            .state;
        assert_eq!(new.book().chapters()[0].annotations().segments[1], old);
        assert_eq!(
            new.book().registry().characters[0],
            human.book().registry().characters[0]
        );
        assert_eq!(new.revision(), human.revision() + 1);
    }
}
#[tokio::test]
async fn grounded_aliases_are_confirmed_and_preserved() {
    let a = first().await;
    let id = a.book().registry().characters[0].id.clone();
    let c = a.book().chapters()[0].annotations();
    let human = a
        .correct(CorrectionBatch {
            book_id: c.book_id.clone(),
            expected_revision: a.revision(),
            corrections: vec![Correction::Aliases {
                character_id: id,
                aliases: vec!["张三".into()],
                evidence: vec![EvidenceRef {
                    chapter_id: c.chapter_id.clone(),
                    segment_id: c.segments[0].id.clone(),
                }],
            }],
        })
        .unwrap();
    let next = human
        .analyze(
            &Model::new(false, true),
            request(
                &human,
                "z",
                human.book().chapters()[0].source().text(),
                BookAnalysisMode::ReanalyzeLast,
            ),
            &AnalysisOptions::default(),
            &CancellationToken::new(),
        )
        .await
        .unwrap()
        .state;
    assert_eq!(
        next.book().registry().characters[0],
        human.book().registry().characters[0]
    );
    assert_eq!(
        next.book().chapters()[0].annotations().segments[1].kind,
        ExpressionKind::Narration
    );
}
struct Failure;
impl AnalysisModel for Failure {
    async fn generate(&self, _: ModelRequest) -> Result<ModelResponse, ModelError> {
        Err(ModelError::Transport)
    }
}
#[tokio::test]
async fn failures_cancellation_and_invalid_history_do_not_mutate_state() {
    let a = first().await;
    let before = a.document();
    assert!(
        a.analyze(
            &Failure,
            request(
                &a,
                "z",
                a.book().chapters()[0].source().text(),
                BookAnalysisMode::ReanalyzeLast
            ),
            &AnalysisOptions::default(),
            &CancellationToken::new()
        )
        .await
        .is_err()
    );
    let cancel = CancellationToken::new();
    cancel.cancel();
    let model = Model::new(false, false);
    assert!(
        a.analyze(
            &model,
            request(&a, "x", "文本", BookAnalysisMode::Append),
            &AnalysisOptions::default(),
            &cancel
        )
        .await
        .is_err()
    );
    assert_eq!(model.calls.load(Ordering::SeqCst), 0);
    assert_eq!(a.document(), before);
    let mut doc = before.clone();
    doc.changes[0].revision = 0;
    assert!(BookState::from_document(doc).is_err());
    let mut doc = before;
    doc.chapters[0].annotations.segments[0]
        .extensions
        .insert("castglean.human_confirmed".into(), false.into());
    assert!(BookState::from_document(doc).is_err());
}

#[tokio::test]
async fn future_alias_evidence_and_earlier_reanalysis_are_bounded() {
    let a = first().await;
    let b = a
        .analyze(
            &Model::new(false, false),
            request(
                &a,
                "a",
                "老张是张三。老张说：“等等。”",
                BookAnalysisMode::Append,
            ),
            &AnalysisOptions::default(),
            &CancellationToken::new(),
        )
        .await
        .unwrap()
        .state;
    let c = b.book().chapters()[1].annotations();
    let id = b.book().registry().characters[0].id.clone();
    let human = b
        .correct(CorrectionBatch {
            book_id: c.book_id.clone(),
            expected_revision: b.revision(),
            corrections: vec![Correction::Aliases {
                character_id: id,
                aliases: vec!["老张".into()],
                evidence: vec![EvidenceRef {
                    chapter_id: c.chapter_id.clone(),
                    segment_id: c.segments[0].id.clone(),
                }],
            }],
        })
        .unwrap();
    assert!(
        human
            .candidates("老张", &ChapterId::new("z").unwrap())
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        human
            .candidates("老张", &ChapterId::new("a").unwrap())
            .unwrap()
            .len(),
        1
    );
    let model = Model::new(false, false);
    assert!(
        human
            .analyze(
                &model,
                request(
                    &human,
                    "z",
                    a.book().chapters()[0].source().text(),
                    BookAnalysisMode::ReanalyzeLast
                ),
                &AnalysisOptions::default(),
                &CancellationToken::new()
            )
            .await
            .is_err()
    );
    assert_eq!(model.calls.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn confirmed_resolved_and_ambiguous_keep_ranges_and_extensions() {
    let a = first().await;
    let b = a
        .analyze(
            &Model::new(true, false),
            request(&a, "a", "另一个张三说：“等等。”", BookAnalysisMode::Append),
            &AnalysisOptions::default(),
            &CancellationToken::new(),
        )
        .await
        .unwrap()
        .state;
    let ids: Vec<_> = b
        .book()
        .registry()
        .characters
        .iter()
        .map(|c| c.id.clone())
        .collect();
    let evidence = vec![b.book().chapters()[1].annotations().segments[0].id.clone()];
    for attribution in [
        Attribution::Resolved {
            character_id: ids[1].clone(),
            evidence_segment_ids: evidence.clone(),
            review_status: ReviewStatus::Unreviewed,
        },
        Attribution::Ambiguous {
            candidate_ids: ids.clone(),
            evidence_segment_ids: evidence.clone(),
            review_status: ReviewStatus::Unreviewed,
        },
    ] {
        let human = b
            .correct(correction(&b, ExpressionKind::Speech, Some(attribution)))
            .unwrap();
        let expected = human.book().chapters()[1].annotations().segments[1].clone();
        let reanalyzed = human
            .analyze(
                &Model::new(false, true),
                request(
                    &human,
                    "a",
                    human.book().chapters()[1].source().text(),
                    BookAnalysisMode::ReanalyzeLast,
                ),
                &AnalysisOptions::default(),
                &CancellationToken::new(),
            )
            .await
            .unwrap()
            .state;
        assert_eq!(
            reanalyzed.book().chapters()[1].annotations().segments[1],
            expected
        );
        assert_eq!(
            reanalyzed.book().chapters()[1].source().metadata(),
            human.book().chapters()[1].source().metadata()
        );
    }
}

#[tokio::test]
async fn detailed_book_failures_do_not_mutate_source_or_revision() {
    struct Failed;
    impl AnalysisModel for Failed {
        async fn generate(&self, _: ModelRequest) -> Result<ModelResponse, ModelError> {
            Err(ModelError::Transport)
        }
    }
    let state = first().await;
    let before = state.document();
    let failure = state
        .analyze_detailed(
            &Failed,
            request(&state, "next", "甲", BookAnalysisMode::Append),
            &AnalysisOptions::default(),
            &CancellationToken::new(),
        )
        .await
        .err()
        .unwrap();
    assert_eq!(failure.diagnostics().unwrap().category(), "service");
    assert_eq!(state.document(), before);
    let mut stale = request(&state, "next", "甲", BookAnalysisMode::Append);
    stale.expected_revision -= 1;
    let failure = state
        .analyze_detailed(
            &Failed,
            stale,
            &AnalysisOptions::default(),
            &CancellationToken::new(),
        )
        .await
        .err()
        .unwrap();
    assert!(failure.diagnostics().is_none());
    assert!(matches!(failure.into_error(), BookError::Revision { .. }));
}
