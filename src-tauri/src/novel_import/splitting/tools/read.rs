//! Pure, bounded projections of an already source-verified project.
use super::*;

use serde::Serialize;
#[derive(Serialize)]
struct SourceSummary<'a> {
    id: &'a str,
    filename: &'a str,
    sha256: &'a str,
    bytes: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChapterSummary<'a> {
    id: &'a str,
    source_id: &'a str,
    title: &'a str,
    heading: Option<u32>,
    volume_id: Option<&'a str>,
}
#[derive(Serialize)]
struct DirectoryReply<'a> {
    sources: Vec<SourceSummary<'a>>,
    rules: Vec<&'a HeadingRule>,
    manual_corrections: Vec<&'a crate::project::Correction>,
    chapters: Vec<ChapterSummary<'a>>,
    chapter_count: usize,
    source_count: usize,
    rule_count: usize,
    issues: Vec<&'a ImportIssue>,
    next_page: Option<u32>,
}
#[derive(Serialize)]
struct HeadingHit<'a> {
    line: usize,
    text: &'a str,
}
#[derive(Serialize)]
struct SearchReply<'a> {
    source_id: &'a str,
    hits: Vec<HeadingHit<'a>>,
    total: usize,
    next_page: Option<u32>,
}
fn bounded(value: impl Serialize) -> Result<Value, ProjectError> {
    let value = serde_json::to_value(value).map_err(|_| ProjectError::InvalidProject)?;
    if serde_json::to_vec(&value)
        .map_err(|_| ProjectError::InvalidProject)?
        .len()
        > 8192
    {
        return Err(ProjectError::TooLarge);
    }
    Ok(value)
}

pub(super) fn inspect(
    record: &LocalProject,
    token: &CancellationToken,
    command: Command,
) -> Result<Value, ProjectError> {
    match command {
        Command::Directory(Directory { page }) => {
            if page > 2000 {
                return Err(ProjectError::TooLarge);
            }
            let offset = page as usize * 5;
            let project = &record.document.project;
            let rules: Vec<HeadingRule> = serde_json::from_value(record.edit.rules.clone())
                .map_err(|_| ProjectError::InvalidProject)?;
            let issues: Vec<ImportIssue> = serde_json::from_value(record.edit.issues.clone())
                .map_err(|_| ProjectError::InvalidProject)?;
            let next_page = (offset + 5
                < [
                    project.sources.len(),
                    rules.len(),
                    project.chapters.len(),
                    project.corrections.len(),
                    issues.len(),
                ]
                .into_iter()
                .max()
                .unwrap_or(0))
            .then_some(page + 1);
            bounded(DirectoryReply {
                sources: project
                    .sources
                    .iter()
                    .skip(offset)
                    .take(5)
                    .map(|s| SourceSummary {
                        id: &s.id,
                        filename: &s.filename,
                        sha256: &s.sha256,
                        bytes: s.text.len(),
                    })
                    .collect(),
                rules: rules.iter().skip(offset).take(5).collect(),
                manual_corrections: project.corrections.iter().skip(offset).take(5).collect(),
                chapters: project
                    .chapters
                    .iter()
                    .skip(offset)
                    .take(5)
                    .map(|c| ChapterSummary {
                        id: &c.id,
                        source_id: &c.source_id,
                        title: &c.title,
                        heading: c.heading,
                        volume_id: c.volume_id.as_deref(),
                    })
                    .collect(),
                chapter_count: project.chapters.len(),
                source_count: project.sources.len(),
                rule_count: rules.len(),
                issues: issues.iter().skip(offset).take(5).collect(),
                next_page,
            })
        }
        Command::ReadContext(ReadContext {
            source_id,
            line,
            count,
        }) => {
            if count == 0 || count > 30 {
                return Err(ProjectError::TooLarge);
            }
            let source = record
                .document
                .project
                .sources
                .iter()
                .find(|s| s.id == source_id)
                .ok_or(ProjectError::NotFound)?;
            let mut count = count;
            loop {
                match bounded(project::source_text_page(source, line, count)?) {
                    Ok(page) => return Ok(page),
                    Err(ProjectError::TooLarge) if count > 1 => {}
                    Err(error) => return Err(error),
                }
                count /= 2;
            }
        }
        Command::SearchHeadings(SearchHeadings {
            source_id,
            pattern,
            page,
        }) => {
            if pattern.len() > 4096 || page > 2000 {
                return Err(ProjectError::TooLarge);
            }
            let regex = regex::RegexBuilder::new(&pattern)
                .size_limit(1024 * 1024)
                .dfa_size_limit(1024 * 1024)
                .build()
                .map_err(|_| ProjectError::InvalidRule)?;
            let source = record
                .document
                .project
                .sources
                .iter()
                .find(|s| s.id == source_id)
                .ok_or(ProjectError::NotFound)?;
            let mut hits = Vec::new();
            let mut count = 0;
            for (line, &(a, b)) in line_ranges(&source.text).iter().enumerate() {
                if token.is_cancelled() {
                    return Err(ProjectError::Cancelled);
                }
                let text = source.text[a as usize..b as usize].trim();
                if text.chars().count() > 120 || !regex.is_match(text) {
                    continue;
                }
                if count >= page as usize * 10 && hits.len() < 10 {
                    hits.push(HeadingHit { line, text });
                }
                count += 1;
            }
            bounded(SearchReply {
                source_id: &source.id,
                hits,
                total: count,
                next_page: ((page as usize + 1) * 10 < count).then_some(page + 1),
            })
        }
        _ => Err(ProjectError::InvalidProject),
    }
}
