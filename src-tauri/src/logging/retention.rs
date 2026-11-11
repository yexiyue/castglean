//! Bounded rolling writer, used only by the non-blocking logging worker.
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub(super) const PREFIX: &str = "castglean.log.v2.";
const SEGMENT_BYTES: u64 = 1024 * 1024;

pub(super) struct BoundedWriter {
    dir: PathBuf,
    cap: u64,
    segment: u64,
    days: u64,
    current: Option<(u64, u64, File)>,
}

impl BoundedWriter {
    pub(super) fn new(dir: PathBuf, cap: u64, segment: u64, days: u64) -> io::Result<Self> {
        assert!(cap > 0 && segment > 0);
        let mut writer = Self {
            dir,
            cap,
            segment: segment.min(cap),
            days,
            current: None,
        };
        writer.prune(0)?;
        Ok(writer)
    }

    fn files(&self) -> io::Result<Vec<(SystemTime, u64, PathBuf)>> {
        let mut files = Vec::new();
        for entry in fs::read_dir(&self.dir)? {
            let entry = entry?;
            if !entry.file_name().to_string_lossy().starts_with(PREFIX) {
                continue;
            }
            let metadata = entry.metadata()?;
            if metadata.is_file() {
                files.push((metadata.modified()?, metadata.len(), entry.path()));
            }
        }
        files.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.2.cmp(&b.2)));
        Ok(files)
    }

    fn prune(&mut self, reserve: u64) -> io::Result<()> {
        let files = self.files()?;
        let mut total: u64 = files.iter().map(|(_, size, _)| size).sum();
        let cutoff = SystemTime::now()
            .checked_sub(Duration::from_secs(self.days.saturating_mul(86400)))
            .unwrap_or(UNIX_EPOCH);
        for (modified, size, path) in files {
            if modified < cutoff || total.saturating_add(reserve) > self.cap {
                fs::remove_file(path)?;
                total = total.saturating_sub(size);
            }
        }
        Ok(())
    }

    fn rotate(&mut self, day: u64) -> io::Result<()> {
        self.current = None;
        // Reserve a full segment before writing, so the bound also holds between rotations.
        self.prune(self.segment)?;
        for sequence in 0u64.. {
            let path = self.dir.join(format!("{PREFIX}{day:010}.{sequence:010}"));
            match OpenOptions::new().write(true).create_new(true).open(path) {
                Ok(file) => {
                    self.current = Some((day, 0, file));
                    return Ok(());
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        unreachable!()
    }
}

impl Write for BoundedWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        let day = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            / 86400;
        if self
            .current
            .as_ref()
            .is_none_or(|(current_day, size, _)| *current_day != day || *size >= self.segment)
        {
            self.rotate(day)?;
        }
        let (_, size, file) = self.current.as_mut().expect("rotation opened a segment");
        let count = file.write(&buf[..buf.len().min((self.segment - *size) as usize)])?;
        *size += count as u64;
        Ok(count)
    }
    fn flush(&mut self) -> io::Result<()> {
        if let Some((_, _, file)) = &mut self.current {
            file.flush()?;
        }
        Ok(())
    }
}

pub(super) fn production(dir: PathBuf, cap: u64, days: u64) -> io::Result<BoundedWriter> {
    BoundedWriter::new(dir, cap, SEGMENT_BYTES, days)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn live_writes_remain_bounded_across_rotations_and_restart() {
        let dir = tempfile::tempdir().unwrap();
        let mut writer = BoundedWriter::new(dir.path().into(), 24, 8, 7).unwrap();
        for n in 0..10 {
            writer.write_all(format!("{n:08}").as_bytes()).unwrap();
            let files = writer.files().unwrap();
            assert!(files.iter().map(|f| f.1).sum::<u64>() <= 24);
        }
        drop(writer);
        let mut writer = BoundedWriter::new(dir.path().into(), 24, 8, 7).unwrap();
        writer.write_all(b"restart!").unwrap();
        let files = writer.files().unwrap();
        assert!(files.iter().map(|f| f.1).sum::<u64>() <= 24);
        let content = files
            .iter()
            .map(|f| fs::read_to_string(&f.2).unwrap())
            .collect::<String>();
        assert!(content.contains("restart!"));
        assert!(!content.contains("00000000"));
    }
    #[test]
    fn oversized_existing_segment_is_removed_and_legacy_files_are_untouched() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(format!("{PREFIX}old")), vec![0; 40]).unwrap();
        fs::write(dir.path().join("castglean.log.2026-11-11"), b"legacy").unwrap();
        let mut writer = BoundedWriter::new(dir.path().into(), 24, 8, 7).unwrap();
        writer.write_all(b"new").unwrap();
        assert!(writer.files().unwrap().iter().map(|f| f.1).sum::<u64>() <= 24);
        assert_eq!(
            fs::read(dir.path().join("castglean.log.2026-11-11")).unwrap(),
            b"legacy"
        );
    }
}
