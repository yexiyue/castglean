//! Host-owned audio/silence plan shared by playback and WAV export.
use super::{ChapterAudioError, ChapterAudioState, arrangement, store};
use sea_orm::DatabaseConnection;
use serde::Serialize;

#[derive(Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    pub unit_index: u32,
    pub pause_after: Option<u32>,
    pub media_id: String,
    pub duration_ms: f64,
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Playback {
    pub run_id: String,
    pub revision: u32,
    pub entries: Vec<Entry>,
    pub gap_index: Option<u32>,
}

pub(crate) fn silence(
    state: &ChapterAudioState,
    run_id: &str,
    ms: u32,
    spec: hound::WavSpec,
) -> Result<(String, f64), ChapterAudioError> {
    let frames = (f64::from(ms) * f64::from(spec.sample_rate) / 1000.0).round() as u64;
    let key = format!(
        "silence:{run_id}:{}:{}:{frames}",
        spec.sample_rate, spec.channels
    );
    let id = crate::project::hash(key.as_bytes())[..32].to_owned();
    let path = state.run_dir(run_id).join(format!("silence-{id}.wav"));
    if !path.exists() {
        std::fs::create_dir_all(state.run_dir(run_id))
            .map_err(|_| ChapterAudioError::WriteFailed)?;
        let file = tempfile::NamedTempFile::new_in(state.run_dir(run_id))
            .map_err(|_| ChapterAudioError::WriteFailed)?;
        let mut wav = hound::WavWriter::new(file.as_file(), spec)
            .map_err(|_| ChapterAudioError::WriteFailed)?;
        for _ in 0..frames * u64::from(spec.channels) {
            wav.write_sample(0i16)
                .map_err(|_| ChapterAudioError::WriteFailed)?;
        }
        wav.finalize().map_err(|_| ChapterAudioError::WriteFailed)?;
        file.as_file()
            .sync_all()
            .map_err(|_| ChapterAudioError::WriteFailed)?;
        if let Err(e) = file.persist_noclobber(&path)
            && e.error.kind() != std::io::ErrorKind::AlreadyExists
        {
            return Err(ChapterAudioError::WriteFailed);
        }
    }
    if !state.publish_media(&id, path) {
        return Err(ChapterAudioError::ReadFailed);
    }
    Ok((id, frames as f64 / f64::from(spec.sample_rate) * 1000.0))
}

/// Called on the blocking pool: disk headers, silence preparation, and DB reads.
pub(crate) async fn prepare(
    db: &DatabaseConnection,
    state: &ChapterAudioState,
    project: &str,
    run_id: &str,
    from: u32,
) -> Result<Playback, ChapterAudioError> {
    let row = store::find(db, run_id).await?;
    if row.project_id != project {
        return Err(ChapterAudioError::NotFound);
    }
    let arrangement = arrangement::read(db, &row).await?;
    let units = store::units(db, run_id).await?;
    let mut output = Playback {
        run_id: run_id.into(),
        revision: arrangement.revision,
        entries: vec![],
        gap_index: None,
    };
    for unit in units.iter().filter(|u| u.index >= from as i32) {
        if unit.status == "empty" {
            continue;
        }
        let Some((id, path)) = unit
            .media_id
            .as_ref()
            .and_then(|id| state.media_path(id).map(|p| (id, p)))
            .filter(|_| unit.status == "done")
        else {
            output.gap_index = Some(unit.index as u32);
            break;
        };
        let reader = hound::WavReader::open(path).map_err(|_| ChapterAudioError::ReadFailed)?;
        let spec = reader.spec();
        if spec.bits_per_sample != 16 || spec.sample_format != hound::SampleFormat::Int {
            return Err(ChapterAudioError::InvalidData);
        }
        let duration = f64::from(reader.duration()) / f64::from(spec.sample_rate) * 1000.0;
        output.entries.push(Entry {
            unit_index: unit.index as u32,
            pause_after: None,
            media_id: id.clone(),
            duration_ms: duration,
        });
        if let Some(pause) = arrangement
            .pauses
            .iter()
            .find(|p| p.after_index == unit.index as u32)
        {
            // A pause cannot make the next missing unit playable.
            let (media_id, duration_ms) = silence(state, run_id, pause.duration_ms, spec)?;
            output.entries.push(Entry {
                unit_index: unit.index as u32,
                pause_after: Some(unit.index as u32),
                media_id,
                duration_ms,
            });
        }
    }
    Ok(output)
}

/// Bounded source excerpts for visible track units.
pub(crate) fn summaries(
    root: &std::path::Path,
    digest: &str,
    units: Vec<crate::database::entity::chapter_audio_unit::Model>,
    from: u32,
    count: u32,
) -> Result<Vec<(u32, String)>, ChapterAudioError> {
    if count > 128 {
        return Err(ChapterAudioError::InvalidData);
    }
    let units: Vec<_> = units
        .into_iter()
        .filter(|u| u.index >= from as i32)
        .take(count as usize)
        .collect();
    let ranges: Vec<_> = units
        .iter()
        .map(|u| {
            Ok((
                u32::try_from(u.range_start).map_err(|_| ChapterAudioError::InvalidData)?,
                u32::try_from(u.range_end).map_err(|_| ChapterAudioError::InvalidData)?,
            ))
        })
        .collect::<Result<_, ChapterAudioError>>()?;
    let texts = crate::project::source_asset_prefixes(root, digest, &ranges, 80)
        .map_err(|_| ChapterAudioError::ReadFailed)?;
    Ok(units
        .into_iter()
        .zip(texts)
        .map(|(u, text)| (u.index as u32, text))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn silence_is_real_pcm_with_exact_frame_duration_and_reusable_identity() {
        let root = tempfile::tempdir().unwrap();
        let state = ChapterAudioState::new(root.path().into());
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 22050,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let (id, ms) = silence(&state, "r1", 810, spec).unwrap();
        assert!((ms - 810.0).abs() <= 1000.0 / 22050.0);
        let mut reader = hound::WavReader::open(state.media_path(&id).unwrap()).unwrap();
        assert!(reader.samples::<i16>().all(|s| s.unwrap() == 0));
        assert_eq!(silence(&state, "r1", 810, spec).unwrap().0, id);
    }
}
