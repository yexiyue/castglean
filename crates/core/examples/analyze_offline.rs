//! Provider-free example of the public analysis boundary.
use castglean_core::*;

struct UnknownModel;
impl AnalysisModel for UnknownModel {
    async fn generate(&self, request: ModelRequest) -> Result<ModelResponse, ModelError> {
        let payload: serde_json::Value = serde_json::from_str(&request.user).unwrap();
        let segments: Vec<_> = payload["segments"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|s| s["target"] == true)
            .map(|s| {
                serde_json::json!({
                    "segment_id": s["id"], "kind": "speech",
                    "attribution": {"status":"unknown", "evidence_segment_ids":[]}
                })
            })
            .collect();
        Ok(ModelResponse {
            text: serde_json::json!({"characters":[],"segments":segments}).to_string(),
            truncated: false,
            usage: Default::default(),
        })
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let result = analyze_chapter(
        &UnknownModel,
        AnalysisInput {
            book_id: BookId::new("demo")?,
            chapter_id: ChapterId::new("chapter-1")?,
            source: SourceSnapshot::import("“有人吗？”"),
            context: None,
        },
        &AnalysisOptions::default(),
        &CancellationToken::new(),
    )
    .await?;
    write_json(std::io::stdout(), result.book.chapters()[0].annotations())?;
    Ok(())
}
