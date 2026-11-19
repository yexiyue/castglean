//! Compact, bounded envelopes for chapter media.
use std::{collections::VecDeque, fs::File, io::BufReader, path::Path, sync::Mutex};

#[derive(Default)]
pub(super) struct Cache(Mutex<VecDeque<(String, Vec<f32>)>>);

impl Cache {
    pub(super) fn read(&self, id: &str, path: &Path) -> Option<Vec<f32>> {
        // Only waveform jobs contend here. Holding this lock through decoding
        // lets overlapping viewport requests share one decode.
        let mut entries = self.0.lock().ok()?;
        if let Some(index) = entries.iter().position(|(key, _)| key == id) {
            let entry = entries.remove(index)?;
            let peaks = entry.1.clone();
            entries.push_back(entry);
            return Some(peaks);
        }
        let peaks = read_peaks(path)?;
        if entries.len() == 256 {
            entries.pop_front();
        }
        entries.push_back((id.to_owned(), peaks.clone()));
        Some(peaks)
    }
}

fn read_peaks(path: &Path) -> Option<Vec<f32>> {
    let envelope =
        crate::voices::studio::extract_waveform(BufReader::new(File::open(path).ok()?)).ok()?;
    let peaks = envelope.peaks.into_iter().next()?;
    let group = peaks.len().div_ceil(64).max(1);
    Some(
        peaks
            .chunks(group)
            .map(|values| values.iter().copied().fold(0.0f32, f32::max))
            .collect(),
    )
}
