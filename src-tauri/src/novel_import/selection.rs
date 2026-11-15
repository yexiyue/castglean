//! Transient, immutable file selections. Confirmed sources publish into project storage.
use super::encoding::decode;
use serde::Serialize;
pub(crate) mod commands;
use crate::project::{self, ProjectError};
use std::{
    collections::HashMap,
    io::Read,
    path::Path,
    sync::{Arc, Mutex},
};

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FilePreview {
    pub id: String,
    pub filename: String,
    pub encoding: String,
    pub bytes: u32,
    pub samples: Vec<String>,
    pub samples_overlap: bool,
}

#[derive(Clone)]
pub(crate) struct SelectedSource {
    pub id: String,
    pub filename: String,
    pub raw: Arc<Vec<u8>>,
}

#[derive(Default)]
pub(crate) struct Selections(Mutex<HashMap<String, SelectedSource>>);

impl Selections {
    pub(crate) fn select(&self, path: &Path) -> Result<FilePreview, ProjectError> {
        if !path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("txt"))
        {
            return Err(ProjectError::InvalidFormat);
        }
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .map_err(|_| ProjectError::ReadFailed)?
            .take(32 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ProjectError::ReadFailed)?;
        if bytes.len() > 32 * 1024 * 1024 {
            return Err(ProjectError::TooLarge);
        }
        let encoding = if std::str::from_utf8(&bytes).is_ok() {
            "utf-8"
        } else {
            "gb18030"
        };
        let filename = path
            .file_name()
            .ok_or(ProjectError::InvalidFormat)?
            .to_string_lossy()
            .into_owned();
        if filename.chars().count() > 255 || filename.chars().any(char::is_control) {
            return Err(ProjectError::InvalidFormat);
        }
        let selected = SelectedSource {
            id: uuid::Uuid::new_v4().to_string(),
            filename,
            raw: Arc::new(bytes),
        };
        let preview = selected.preview(encoding)?;
        let mut selections = self.0.lock().map_err(|_| ProjectError::Busy)?;
        if selections.len() >= 128
            || selections.values().map(|s| s.raw.len()).sum::<usize>() + selected.raw.len()
                > project::MAX_TOTAL
        {
            return Err(ProjectError::TooLarge);
        }
        selections.insert(selected.id.clone(), selected);
        Ok(preview)
    }
    pub(crate) fn get(&self, id: &str) -> Result<SelectedSource, ProjectError> {
        self.0
            .lock()
            .map_err(|_| ProjectError::Busy)?
            .get(id)
            .cloned()
            .ok_or(ProjectError::NotFound)
    }
    pub(crate) fn preview(&self, id: &str, encoding: &str) -> Result<FilePreview, ProjectError> {
        self.get(id)?.preview(encoding)
    }
    pub(crate) fn release(&self, id: &str) -> Result<(), ProjectError> {
        self.0.lock().map_err(|_| ProjectError::Busy)?.remove(id);
        Ok(())
    }
    /// 对话框与拖放共用的批量入口：任一文件失败即回滚整批，不留部分选择。
    pub(crate) fn select_many(
        &self,
        paths: &[std::path::PathBuf],
    ) -> Result<Vec<FilePreview>, ProjectError> {
        if paths.len() > 128 {
            return Err(ProjectError::TooLarge);
        }
        let mut selected = Vec::new();
        for path in paths {
            match self.select(path) {
                Ok(preview) => selected.push(preview),
                Err(error) => {
                    for preview in selected {
                        let _ = self.release(&preview.id);
                    }
                    return Err(error);
                }
            }
        }
        Ok(selected)
    }
    #[cfg(test)]
    pub(crate) fn count(&self) -> usize {
        self.0.lock().map(|s| s.len()).unwrap_or_default()
    }
}
impl SelectedSource {
    fn preview(&self, encoding: &str) -> Result<FilePreview, ProjectError> {
        let text = decode(&self.raw, encoding)?;
        let lines = project::line_ranges(&text);
        let ranges: Vec<_> = [0, lines.len() / 2, lines.len().saturating_sub(4)]
            .into_iter()
            .filter_map(|line| {
                let &(start, _) = lines.get(line)?;
                let end = lines[(line + 4).min(lines.len()) - 1].1;
                let sample = &text[start as usize..end as usize];
                let length = sample
                    .char_indices()
                    .nth(1000)
                    .map_or(sample.len(), |(i, _)| i);
                Some((start as usize, start as usize + length))
            })
            .collect();
        let samples_overlap = ranges.iter().enumerate().any(|(i, &(start, end))| {
            ranges
                .iter()
                .skip(i + 1)
                .any(|&(other_start, other_end)| start < other_end && other_start < end)
        });
        let samples = ranges
            .into_iter()
            .map(|(start, end)| text[start..end].to_owned())
            .collect();
        Ok(FilePreview {
            id: self.id.clone(),
            filename: self.filename.clone(),
            encoding: encoding.into(),
            bytes: self.raw.len() as u32,
            samples,
            samples_overlap,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preview(raw: Vec<u8>, encoding: &str) -> FilePreview {
        SelectedSource {
            id: "test".into(),
            filename: "sample.txt".into(),
            raw: Arc::new(raw),
        }
        .preview(encoding)
        .unwrap()
    }

    #[test]
    fn sample_overlap_uses_source_ranges_not_matching_text() {
        let short = preview("一\n二\n三\n".as_bytes().to_vec(), "utf-8");
        assert!(short.samples_overlap);
        let long = preview("相同\n".repeat(20).into_bytes(), "utf-8");
        assert!(!long.samples_overlap);
        assert_eq!(long.samples.len(), 3);
        assert_eq!(long.samples[0], long.samples[1]);
    }

    #[test]
    fn gbk_preview_reports_overlap_after_decoding() {
        let (raw, _, errors) = encoding_rs::GBK.encode("一\n二\n三\n");
        assert!(!errors);
        let result = preview(raw.into_owned(), "gbk");
        assert!(result.samples_overlap);
        assert!(result.samples[0].contains('一'));
    }

    /// 临时 txt 文件，返回绝对路径。
    fn temp_txt(name: &str, body: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "castglean-select-many-{}-{}",
            std::process::id(),
            name
        ));
        std::fs::write(&path, body).expect("write temp file");
        path
    }

    #[test]
    fn select_many_accepts_multiple_txt_and_rolls_back_on_invalid() {
        let selections = Selections::default();
        let a = temp_txt("a.txt", "第一章 山雨\n正文。");
        let b = temp_txt("b.txt", "第二章 来客\n正文。");
        let bad = temp_txt("not-txt.pdf", "x");
        let previews = selections
            .select_many(&[a.clone(), b.clone()])
            .expect("batch of txt files");
        assert_eq!(previews.len(), 2);
        assert_eq!(selections.count(), 2);

        // 批内含非 txt：整批失败且该批次不留任何选择。
        let err = selections
            .select_many(&[a.clone(), b.clone(), bad.clone()])
            .expect_err("mixed batch must fail");
        assert_eq!(err, ProjectError::InvalidFormat);
        assert_eq!(selections.count(), 2, "原有选择不受失败批次影响");
        for preview in previews {
            selections.release(&preview.id).expect("release");
        }
        assert_eq!(selections.count(), 0);
        for path in [a, b, bad] {
            let _ = std::fs::remove_file(path);
        }
    }

    #[test]
    fn select_many_rejects_oversized_batches() {
        let selections = Selections::default();
        let paths: Vec<_> = (0..129)
            .map(|i| temp_txt(&format!("{i}.txt"), "正文"))
            .collect();
        let err = selections
            .select_many(&paths)
            .expect_err("over 128 files must fail");
        assert_eq!(err, ProjectError::TooLarge);
        assert_eq!(selections.count(), 0);
        for path in paths {
            let _ = std::fs::remove_file(path);
        }
    }
}
