//! Deterministic partition edits. No persistence, model, queue or UI types.
use super::detection::{self, HeadingRule, ImportIssue};
use crate::project::{self, ProjectDocument, ProjectError};
use tokio_util::sync::CancellationToken;

pub(crate) fn regroup(document: &mut ProjectDocument) {
    let project = &mut document.project;
    for chapter in &mut project.chapters {
        let line = chapter.heading.unwrap_or(0);
        let explicit_group = project
            .corrections
            .iter()
            .find(|correction| {
                correction.source_id == chapter.source_id
                    && Some(correction.line) == chapter.heading
            })
            .and_then(|correction| correction.volume_id.clone());
        chapter.volume_id = explicit_group.or_else(|| {
            project
                .volumes
                .iter()
                .filter(|volume| volume.source_id == chapter.source_id && volume.line <= line)
                .max_by_key(|volume| volume.line)
                .map(|volume| volume.id.clone())
        });
    }
}

pub(crate) fn patch_boundaries(
    document: &mut ProjectDocument,
    current_issues: &mut Vec<ImportIssue>,
    patches: Vec<project::Correction>,
    token: &CancellationToken,
) -> Result<(), ProjectError> {
    let affected: std::collections::HashSet<_> =
        patches.iter().map(|p| p.source_id.clone()).collect();
    for patch in patches {
        document
            .project
            .corrections
            .retain(|c| c.source_id != patch.source_id || c.line != patch.line);
        document.project.corrections.push(patch);
    }
    for source in document
        .project
        .sources
        .iter()
        .filter(|s| affected.contains(&s.id))
    {
        let previous: Vec<_> = document
            .project
            .chapters
            .iter()
            .filter(|c| c.source_id == source.id)
            .cloned()
            .collect();
        let mut boundaries: Vec<_> = previous
            .iter()
            .filter_map(|c| {
                c.heading.map(|line| project::Correction {
                    source_id: source.id.clone(),
                    line,
                    include: true,
                    title: Some(c.title.clone()),
                    volume_id: c.volume_id.clone(),
                })
            })
            .collect();
        boundaries.extend(
            document
                .project
                .corrections
                .iter()
                .filter(|c| c.source_id == source.id)
                .cloned(),
        );
        let detection::Detection {
            mut chapters,
            issues,
            ..
        } = detection::detect(source, &[], &boundaries, &previous, token)?;
        for chapter in &mut chapters {
            if let Some(line) = chapter.heading {
                if chapter.volume_id.is_none() {
                    chapter.volume_id = document
                        .project
                        .volumes
                        .iter()
                        .filter(|v| v.source_id == source.id && v.line <= line)
                        .max_by_key(|v| v.line)
                        .map(|v| v.id.clone());
                }
            } else if let Some(old) = previous
                .iter()
                .find(|old| old.heading.is_none() && old.start == chapter.start)
            {
                chapter.title = old.title.clone();
            }
        }
        let position = document
            .project
            .chapters
            .iter()
            .position(|c| c.source_id == source.id)
            .ok_or(ProjectError::InvalidProject)?;
        document
            .project
            .chapters
            .retain(|c| c.source_id != source.id);
        document
            .project
            .chapters
            .splice(position..position, chapters);
        current_issues.retain(|i| i.source_id != source.id);
        current_issues.extend(issues);
    }
    document.validate()
}

pub(crate) fn recalculate(
    document: &mut ProjectDocument,
    rules: &[HeadingRule],
    single_chapter_sources: &[String],
    current_issues: &mut Vec<ImportIssue>,
    token: &CancellationToken,
) -> Result<(), ProjectError> {
    let p = &mut document.project;
    let mut chapters = Vec::new();
    let mut volumes: Vec<_> = p.volumes.iter().filter(|v| v.manual).cloned().collect();
    let mut issues = Vec::new();
    for source in &p.sources {
        let detection::Detection {
            chapters: c,
            volumes: v,
            issues: i,
        } = detection::detect(
            source,
            if single_chapter_sources.contains(&source.id) {
                &[]
            } else {
                rules
            },
            &p.corrections,
            &p.chapters,
            token,
        )?;
        chapters.extend(c);
        volumes.extend(v.into_iter().filter(|volume| {
            !p.volumes
                .iter()
                .any(|v| v.manual && v.source_id == volume.source_id && v.line == volume.line)
        }));
        issues.extend(i);
    }
    p.chapters = chapters;
    p.volumes = volumes;
    regroup(document);
    *current_issues = issues;
    document.validate()
}
