//! Extract display peaks on the host blocking pool, without copying PCM over IPC.
use super::VoiceWaveform;
use std::io::{Read, Seek};

const MAX_PEAKS: usize = 1024;

pub(super) fn extract(input: impl Read + Seek) -> Result<VoiceWaveform, String> {
    let mut reader = hound::WavReader::new(input).map_err(|e| e.to_string())?;
    let spec = reader.spec();
    if spec.channels == 0 || spec.sample_rate == 0 {
        return Err("empty or invalid audio".into());
    }
    let frames = reader.duration() as usize;
    if frames == 0 {
        return Err("empty audio".into());
    }
    let bins = frames.min(MAX_PEAKS);
    let mut peaks = vec![0.0f32; bins];
    let expected = frames * usize::from(spec.channels);
    let mut count = 0;
    let mut push = |sample: f32| -> Result<(), String> {
        if !sample.is_finite() || count >= expected {
            return Err("invalid audio samples".into());
        }
        let frame = count / usize::from(spec.channels);
        let bin = frame * bins / frames;
        peaks[bin] = peaks[bin].max(sample.abs().min(1.0));
        count += 1;
        Ok(())
    };
    match spec.sample_format {
        hound::SampleFormat::Float => {
            for sample in reader.samples::<f32>() {
                push(sample.map_err(|e| e.to_string())?)?;
            }
        }
        hound::SampleFormat::Int => {
            if !(1..=32).contains(&spec.bits_per_sample) {
                return Err("unsupported PCM bit depth".into());
            }
            let scale = 2.0f32.powi(i32::from(spec.bits_per_sample) - 1);
            for sample in reader.samples::<i32>() {
                push(sample.map_err(|e| e.to_string())? as f32 / scale)?;
            }
        }
    }
    if count != expected {
        return Err("incomplete audio".into());
    }
    Ok(VoiceWaveform {
        duration: frames as f64 / f64::from(spec.sample_rate),
        peaks: vec![peaks],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn stereo_peaks_preserve_opposite_channels_and_bound_output() {
        let mut wav = Cursor::new(Vec::new());
        let mut writer = hound::WavWriter::new(
            &mut wav,
            hound::WavSpec {
                channels: 2,
                sample_rate: 24000,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            },
        )
        .unwrap();
        for _ in 0..24000 {
            writer.write_sample(i16::MIN).unwrap();
            writer.write_sample(i16::MAX).unwrap();
        }
        writer.finalize().unwrap();
        wav.set_position(0);
        let waveform = extract(wav).unwrap();
        assert_eq!(waveform.duration, 1.0);
        assert_eq!(waveform.peaks.len(), 1);
        assert_eq!(waveform.peaks[0], vec![1.0; MAX_PEAKS]);
    }

    #[test]
    fn float_audio_rejects_non_finite_samples() {
        let mut wav = Cursor::new(Vec::new());
        let mut writer = hound::WavWriter::new(
            &mut wav,
            hound::WavSpec {
                channels: 1,
                sample_rate: 24000,
                bits_per_sample: 32,
                sample_format: hound::SampleFormat::Float,
            },
        )
        .unwrap();
        writer.write_sample(f32::NAN).unwrap();
        writer.finalize().unwrap();
        wav.set_position(0);
        assert!(extract(wav).is_err());
        assert!(extract(Cursor::new(b"invalid WAV")).is_err());
    }
}
