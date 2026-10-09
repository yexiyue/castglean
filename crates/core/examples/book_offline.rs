//! Two original chapters, stable identity reuse, and a source-bound human edit.
use castglean_core::*;
struct Demo;
impl AnalysisModel for Demo {
    async fn generate(&self, request: ModelRequest) -> Result<ModelResponse, ModelError> {
        let p: serde_json::Value = serde_json::from_str(&request.user).expect("application JSON");
        let fresh = p["characters"].as_array().unwrap().is_empty();
        let reference = if fresh {
            serde_json::json!({"scope":"new","id":"person"})
        } else {
            serde_json::json!({"scope":"existing","id":p["characters"][0]["id"]})
        };
        let characters = if fresh {
            serde_json::json!([{"temp_id":"person","display_name":"张三","aliases":[],"evidence_segment_ids":[p["segments"][0]["id"]]}])
        } else {
            serde_json::json!([])
        };
        let segments:Vec<_>=p["segments"].as_array().unwrap().iter().filter(|s|s["target"]==true).map(|s|{
            if s["text"].as_str().unwrap().starts_with('“') {serde_json::json!({"segment_id":s["id"],"kind":"speech","attribution":{"status":"resolved","character":reference,"evidence_segment_ids":[p["segments"][0]["id"]]}})}
            else {serde_json::json!({"segment_id":s["id"],"kind":"narration","attribution":null})}
        }).collect();
        Ok(ModelResponse {
            text: serde_json::json!({"characters":characters,"segments":segments}).to_string(),
            truncated: false,
            usage: Default::default(),
        })
    }
}
#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut state = BookState::new(BookId::new("cross-chapter-demo")?)?;
    for (id, text) in [
        (
            "first",
            include_str!("../../../examples/cross-chapter/chapter-1.txt"),
        ),
        (
            "second",
            include_str!("../../../examples/cross-chapter/chapter-2.txt"),
        ),
    ] {
        state = state
            .analyze(
                &Demo,
                BookAnalysisInput {
                    chapter_id: ChapterId::new(id)?,
                    source: SourceSnapshot::import(text),
                    expected_revision: state.revision(),
                    mode: BookAnalysisMode::Append,
                },
                &AnalysisOptions::default(),
                &CancellationToken::new(),
            )
            .await?
            .state;
    }
    let chapter = state.book().chapters().last().unwrap().annotations();
    let target = chapter
        .segments
        .iter()
        .find(|s| s.kind == ExpressionKind::Speech)
        .unwrap();
    let batch = CorrectionBatch {
        book_id: chapter.book_id.clone(),
        expected_revision: state.revision(),
        corrections: vec![Correction::Attribution {
            chapter_id: chapter.chapter_id.clone(),
            source_sha256: chapter.source.sha256.clone(),
            segment_id: target.id.clone(),
            expression_kind: ExpressionKind::Speech,
            attribution: Some(Attribution::Unknown {
                evidence_segment_ids: vec![],
                review_status: ReviewStatus::Unreviewed,
            }),
        }],
    };
    state = state.correct(batch)?;
    assert_eq!(state.book().registry().characters.len(), 1);
    write_json(std::io::stdout(), &state.document())?;
    Ok(())
}
