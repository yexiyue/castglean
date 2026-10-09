//! Bounded, acknowledged host delivery with an offline synthetic model; no speech backend.
use castglean_core::*;
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};

struct Demo;
impl AnalysisModel for Demo {
    async fn generate(&self, request: ModelRequest) -> Result<ModelResponse, ModelError> {
        let p: Value = serde_json::from_str(&request.user).expect("application request");
        let target = p["segments"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["target"] == true)
            .unwrap();
        let existing = p["characters"].as_array().unwrap();
        let fresh = existing.is_empty();
        let characters = if fresh {
            json!([
                {"temp_id":"a","display_name":"甲","aliases":[],"evidence_segment_ids":[target["id"]]},
                {"temp_id":"b","display_name":"乙","aliases":[],"evidence_segment_ids":[target["id"]]}
            ])
        } else {
            json!([])
        };
        let person = if fresh {
            json!({"scope":"new","id":"a"})
        } else {
            json!({"scope":"existing","id":existing[usize::from(target["text"] == "乙。")]["id"]})
        };
        Ok(ModelResponse {
            text: json!({"characters":characters,"segments":[{"segment_id":target["id"],"kind":"speech","attribution":{"status":"resolved","character":person,"evidence_segment_ids":[target["id"]]}}]}).to_string(),
            truncated: false, usage: TokenUsage::default(),
        })
    }
}
struct Envelope {
    batch: AcceptedPrefixBatch,
    acknowledgment: oneshot::Sender<Result<(), DeliveryError>>,
}
struct HostConsumer(mpsc::Sender<Envelope>);
impl AnalysisConsumer for HostConsumer {
    async fn accept(&mut self, batch: AcceptedPrefixBatch) -> Result<(), DeliveryError> {
        let (acknowledgment, received) = oneshot::channel();
        self.0
            .send(Envelope {
                batch,
                acknowledgment,
            })
            .await
            .map_err(|_| DeliveryError::Closed)?;
        received.await.map_err(|_| DeliveryError::Closed)?
    }
}
#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let source = SourceSnapshot::import(include_str!(
        "../../../examples/incremental-delivery/chapter.txt"
    ));
    let input = AnalysisInput {
        book_id: BookId::new("incremental-demo")?,
        chapter_id: ChapterId::new("chapter")?,
        source: source.clone(),
        context: None,
    };
    let (sender, mut receiver) = mpsc::channel::<Envelope>(1);
    let mut consumer = HostConsumer(sender);
    let options = AnalysisOptions {
        segment_chars: 10,
        window_chars: 10,
        window_segments: 1,
        ..Default::default()
    };
    let cancel = CancellationToken::new();
    // Host-supplied model/configuration scope and a fresh attempt key; reuse neither on retry.
    let produce = async {
        let result = analyze_chapter_incremental(
            &Demo,
            input,
            &options,
            &cancel,
            "demo/model/attempt-1",
            &mut consumer,
        )
        .await;
        drop(consumer); // Queue exhaustion is not analysis completion; inspect result below.
        result
    };
    // Optional explicit first-batch output for inspecting the illustrative JSON shape.
    let output = std::env::args_os().nth(1).map(std::path::PathBuf::from);
    let consume = async {
        let mut run = None;
        let mut sequence = 1;
        let mut end = 0;
        while let Some(Envelope {
            batch,
            acknowledgment,
        }) = receiver.recv().await
        {
            let valid = batch.source_sha256() == source.metadata().sha256
                && batch.book_id().as_str() == "incremental-demo"
                && batch.chapter_id().as_str() == "chapter"
                && batch.sequence() == sequence
                && batch.range().start == end
                && run.as_ref().is_none_or(|id| id == batch.run_id());
            if !valid {
                let _ = acknowledgment.send(Err(DeliveryError::Rejected));
                return Err::<usize, Box<dyn std::error::Error>>(DeliveryError::Rejected.into());
            }
            if sequence == 1
                && let Some(path) = &output
            {
                write_json(std::fs::File::create_new(path)?, &batch)?;
            }
            run = Some(batch.run_id().clone());
            // The host resolves/casts by stable ID using the accompanying definitions.
            for segment in batch.segments() {
                println!(
                    "accepted {}..{} {:?} {:?}",
                    segment.start, segment.end, segment.kind, segment.attribution
                );
            }
            end = batch.range().end;
            sequence += 1;
            let _ = acknowledgment.send(Ok(())); // Atomic host acceptance, not playback completion.
        }
        Ok(end)
    };
    let (analysis, received_end) = tokio::join!(produce, consume);
    let received_end = received_end?;
    match analysis {
        Ok(complete) => {
            assert_eq!(received_end, source.text().len());
            assert_eq!(complete.delivery.confirmed_end(), received_end);
            println!(
                "analysis finished; host may seal its plan: {} bytes",
                received_end
            );
        }
        Err(failure) => {
            eprintln!(
                "analysis failed; host must fail input, not seal: confirmed={}, offered={:?}",
                failure.delivery().confirmed_end(),
                failure.delivery().offered_end()
            );
            return Err(failure.into());
        }
    }
    Ok(())
}
