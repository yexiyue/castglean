//! Frozen inputs and resume, without credentials or CLI configuration.
use castglean_core::*;
struct Narration;
impl AnalysisModel for Narration {
    async fn generate(&self, request: ModelRequest) -> Result<ModelResponse, ModelError> {
        let input: serde_json::Value = serde_json::from_str(&request.user).unwrap();
        let segments: Vec<_> = input["segments"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|s| s["target"] == true)
            .map(
                |s| serde_json::json!({"segment_id":s["id"],"kind":"narration","attribution":null}),
            )
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
    let config = RunConfig::new(
        RunModel {
            backend: "offline".into(),
            model: "narration-fixture".into(),
            endpoint: "none".into(),
            reasoning_effort: "off".into(),
            output_mode: "json".into(),
        },
        AnalysisOptions::default(),
        "example-1".into(),
    );
    let plan = RunPlan {
        format_version: 1,
        base: BookState::new(BookId::new("run-demo")?)?.document(),
        chapters: [("first", "张三走进院子。"), ("second", "张三关上门。")]
            .into_iter()
            .map(|(id, text)| {
                Ok(RunChapter::new(
                    ChapterId::new(id)?,
                    SourceSnapshot::import(text),
                ))
            })
            .collect::<Result<_, castglean_core::Error>>()?,
        config: config.clone(),
    };
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("run");
    let cancel = CancellationToken::new();
    let mut run = BookRun::create(&path, plan)?;
    run.advance(&Narration, &config, &cancel).await?;
    drop(run);
    let mut resumed = BookRun::open(&path)?;
    assert_eq!(resumed.progress().completed, 1);
    while resumed.advance(&Narration, &config, &cancel).await? {}
    assert_eq!(resumed.progress().completed, 2);
    write_json(std::io::stdout(), &resumed.progress())?;
    Ok(())
}
