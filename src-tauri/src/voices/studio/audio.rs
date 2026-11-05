//! Short-audition collection limits are enforced before extending the buffer.
use super::tasks::cancelled;
use talechime::{Pcm, PcmStream, SynthesisState};
use tokio::sync::watch;

#[derive(Default)]
struct Accumulator(Option<Pcm>);
impl Accumulator {
    fn push(&mut self, pcm: &Pcm) -> Result<(), String> {
        pcm.duration_ms().map_err(|e| e.to_string())?;
        let old = self.0.as_ref().map_or(0, |audio| audio.samples.len());
        let samples = old
            .checked_add(pcm.samples.len())
            .ok_or("PCM size overflow")?;
        if samples > 16 * 1024 * 1024 / size_of::<f32>()
            || samples as u64 > u64::from(pcm.sample_rate) * u64::from(pcm.channels) * 30
        {
            return Err("audition exceeds 30 seconds or 16 MiB PCM".into());
        }
        let audio = self.0.get_or_insert_with(|| Pcm {
            samples: vec![],
            sample_rate: pcm.sample_rate,
            channels: pcm.channels,
        });
        if (audio.sample_rate, audio.channels) != (pcm.sample_rate, pcm.channels) {
            return Err("PCM format changed during audition".into());
        }
        audio.samples.extend_from_slice(&pcm.samples);
        Ok(())
    }
}
pub(super) async fn collect(
    mut stream: PcmStream,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Pcm, String> {
    let result = async {
        let mut output = Accumulator::default();
        while let Some(block) = stream.recv().await {
            output.push(block.map_err(|e| e.to_string())?.pcm())?;
        }
        if stream.state() != SynthesisState::Completed {
            return Err("audition did not complete".into());
        }
        output.0.ok_or("model produced no audio".into())
    };
    let outcome = tokio::select! { result = result => result, _ = cancelled(cancel) => Err("cancelled".into()) };
    if outcome.is_err() {
        stream.cancel().await;
    }
    outcome
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn limits_are_checked_before_append_and_invalid_pcm_is_rejected() {
        let mut accumulator = Accumulator::default();
        let pcm = Pcm {
            samples: vec![0.1; 24000 * 30],
            sample_rate: 24000,
            channels: 1,
        };
        accumulator.push(&pcm).unwrap();
        assert!(
            accumulator
                .push(&Pcm {
                    samples: vec![0.1],
                    sample_rate: 24000,
                    channels: 1
                })
                .is_err()
        );
        assert_eq!(accumulator.0.as_ref().unwrap().samples.len(), 24000 * 30);
        assert!(
            Accumulator::default()
                .push(&Pcm {
                    samples: vec![f32::NAN],
                    sample_rate: 24000,
                    channels: 1
                })
                .is_err()
        );
        assert!(
            Accumulator::default()
                .push(&Pcm {
                    samples: vec![0.0],
                    sample_rate: 0,
                    channels: 1
                })
                .is_err()
        );
    }
}
