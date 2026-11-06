//! Deterministic chapter detection. Every boundary refers to an existing immutable source line.
use crate::project::{Chapter, Correction, ProjectError, Source, Volume, line_ranges};
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HeadingRule {
    pub name: String,
    pub pattern: String,
    pub kind: RuleKind,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RuleKind {
    Chapter,
    Volume,
    Exclude,
}
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportIssue {
    pub source_id: String,
    pub line: u32,
    pub kind: String,
}

pub(crate) fn builtin() -> Vec<HeadingRule> {
    [("中文章节", r"^第[0-9零〇一二两三四五六七八九十百千万]{1,12}[章节回话](?:\s|[：:、.．]|$)", RuleKind::Chapter),
     ("英文章节", r"(?i)^chapter\s+[0-9ivxlcdm]+(?:\s|[.:：]|$)", RuleKind::Chapter),
     ("特殊章节", r"^(?:序章|楔子|引子|序言|前言|尾声|后记|终章|番外)(?:\s|[：:、.．0-9一二三四五六七八九十]|$)", RuleKind::Chapter),
     ("分卷", r"^(?:第[0-9零〇一二两三四五六七八九十百千万]{1,12}[卷部篇]|[上中下][卷部篇])(?:\s|[：:、.．]|$)", RuleKind::Volume)]
        .into_iter().map(|(name, pattern, kind)| HeadingRule { name: name.into(), pattern: pattern.into(), kind }).collect()
}

fn line_text<'a>(
    source: &'a Source,
    lines: &[(u32, u32)],
    line: u32,
) -> Result<&'a str, ProjectError> {
    let (a, b) = *lines
        .get(line as usize)
        .ok_or(ProjectError::InvalidProject)?;
    Ok(&source.text[a as usize..b as usize])
}

fn chapter_number(title: &str) -> Option<u32> {
    let number = if let Some(rest) = title.strip_prefix('第') {
        rest.split(['章', '节', '回', '话']).next()?
    } else {
        title.strip_prefix('【')?.split_once('】')?.0
    };
    if let Ok(value) = number.parse() {
        return Some(value);
    }
    let mut section = 0u32;
    let mut digit = 0u32;
    let mut total = 0u32;
    for character in number.chars() {
        match character {
            '零' | '〇' => digit = 0,
            '一' => digit = 1,
            '二' | '两' => digit = 2,
            '三' => digit = 3,
            '四' => digit = 4,
            '五' => digit = 5,
            '六' => digit = 6,
            '七' => digit = 7,
            '八' => digit = 8,
            '九' => digit = 9,
            '十' | '百' | '千' => {
                let unit = match character {
                    '十' => 10,
                    '百' => 100,
                    _ => 1000,
                };
                section = section.checked_add(digit.max(1).checked_mul(unit)?)?;
                digit = 0;
            }
            '万' => {
                total = total.checked_add(section.checked_add(digit)?.checked_mul(10_000)?)?;
                section = 0;
                digit = 0;
            }
            _ => return None,
        }
    }
    total.checked_add(section)?.checked_add(digit)
}

pub(crate) struct Detection {
    pub chapters: Vec<Chapter>,
    pub volumes: Vec<Volume>,
    pub issues: Vec<ImportIssue>,
}

pub(crate) fn detect(
    source: &Source,
    rules: &[HeadingRule],
    corrections: &[Correction],
    previous: &[Chapter],
    cancel: &CancellationToken,
) -> Result<Detection, ProjectError> {
    if rules.len() > 32 {
        return Err(ProjectError::InvalidRule);
    }
    let compiled: Vec<_> = rules
        .iter()
        .map(|r| {
            if r.pattern.len() > 4096 || r.name.chars().count() > 120 {
                return Err(ProjectError::InvalidRule);
            }
            RegexBuilder::new(&r.pattern)
                .size_limit(1024 * 1024)
                .dfa_size_limit(1024 * 1024)
                .build()
                .map(|regex| (r.kind, regex))
                .map_err(|_| ProjectError::InvalidRule)
        })
        .collect::<Result<_, _>>()?;
    let lines = line_ranges(&source.text);
    let mut headings = BTreeMap::<u32, String>::new();
    let mut volumes = Vec::new();
    let mut issues = Vec::new();
    for (line, &(start, end)) in lines.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(ProjectError::Cancelled);
        }
        let value = &source.text[start as usize..end as usize];
        let cleaned = value.trim_end().trim_start_matches([' ', '\t', '\u{feff}']);
        if cleaned.is_empty()
            || cleaned.chars().count() > 120
            || cleaned.ends_with(['。', '．', '.'])
        {
            continue;
        }
        if compiled
            .iter()
            .any(|(kind, regex)| matches!(kind, RuleKind::Exclude) && regex.is_match(cleaned))
        {
            continue;
        }
        if compiled
            .iter()
            .any(|(kind, regex)| matches!(kind, RuleKind::Volume) && regex.is_match(cleaned))
        {
            volumes.push(Volume {
                id: format!("{}-v-{line}", source.id),
                source_id: source.id.clone(),
                title: cleaned.to_owned(),
                line: line as u32,
                manual: false,
            });
        } else if compiled
            .iter()
            .any(|(kind, regex)| matches!(kind, RuleKind::Chapter) && regex.is_match(cleaned))
        {
            headings.insert(line as u32, cleaned.to_owned());
        }
        if headings.len() > 10_000 {
            return Err(ProjectError::TooLarge);
        }
    }
    for c in corrections.iter().filter(|c| c.source_id == source.id) {
        let value = line_text(source, &lines, c.line)?;
        if c.include {
            let title = c
                .title
                .clone()
                .unwrap_or_else(|| value.trim().chars().take(120).collect());
            if title.trim().is_empty() {
                return Err(ProjectError::InvalidProject);
            }
            headings.insert(c.line, title);
        } else {
            headings.remove(&c.line);
        }
    }
    let mut seen = HashSet::new();
    let mut last_start = 0;
    let mut previous_number: Option<u32> = None;
    for (&line, title) in &headings {
        let start = lines[line as usize].0;
        if let Some(number) = chapter_number(title) {
            if previous_number.is_some_and(|previous| number > previous.saturating_add(1)) {
                issues.push(ImportIssue {
                    source_id: source.id.clone(),
                    line,
                    kind: "numbering_gap".into(),
                });
            }
            previous_number = Some(number);
        } else {
            previous_number = None;
        }
        if !seen.insert(title.clone()) {
            issues.push(ImportIssue {
                source_id: source.id.clone(),
                line,
                kind: "duplicate_heading".into(),
            });
        }
        if start.saturating_sub(last_start) < 128 && last_start != 0 {
            issues.push(ImportIssue {
                source_id: source.id.clone(),
                line,
                kind: "short_chapter".into(),
            });
        }
        if start.saturating_sub(last_start) > 100_000 {
            issues.push(ImportIssue {
                source_id: source.id.clone(),
                line,
                kind: "long_chapter".into(),
            });
        }
        last_start = start;
    }
    if headings.is_empty() {
        issues.push(ImportIssue {
            source_id: source.id.clone(),
            line: 0,
            kind: "no_headings".into(),
        });
    }
    if source.text.len() as u32 - last_start > 100_000 {
        issues.push(ImportIssue {
            source_id: source.id.clone(),
            line: lines.len().saturating_sub(1) as u32,
            kind: "long_chapter".into(),
        });
    }
    // Prefix whitespace belongs to the first chapter. Non-whitespace prefix remains a chapter.
    let mut starts: Vec<(u32, String, Option<u32>)> = headings
        .iter()
        .map(|(&line, title)| (lines[line as usize].0, title.clone(), Some(line)))
        .collect();
    if let Some((start, _, _)) = starts.first_mut()
        && *start > 0
        && source.text[..*start as usize]
            .trim_matches(['\u{feff}', ' ', '\t', '\r', '\n'])
            .is_empty()
    {
        *start = 0;
    }
    if starts.first().is_none_or(|s| s.0 != 0) {
        starts.insert(
            0,
            (
                0,
                if starts.is_empty() {
                    source.filename.trim_end_matches(".txt").to_owned()
                } else {
                    "前置内容".into()
                },
                None,
            ),
        );
    }
    let mut chapters = Vec::new();
    let mut used_ids = HashSet::new();
    for (i, (start, title, heading)) in starts.iter().enumerate() {
        let end = starts
            .get(i + 1)
            .map(|s| s.0)
            .unwrap_or(source.text.len() as u32);
        if source.text[*start as usize..end as usize].trim().is_empty() {
            continue;
        }
        let prior = previous
            .iter()
            .find(|c| c.source_id == source.id && c.start == *start)
            .or_else(|| {
                previous.iter().find(|c| {
                    c.source_id == source.id
                        && c.start <= *start
                        && *start < c.end
                        && !used_ids.contains(&c.id)
                })
            });
        let id = prior
            .map(|c| c.id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        used_ids.insert(id.clone());
        let mut predecessor_ids = prior.map(|c| c.predecessor_ids.clone()).unwrap_or_default();
        for old in previous
            .iter()
            .filter(|c| c.source_id == source.id && c.start < end && c.end > *start && c.id != id)
        {
            if !predecessor_ids.contains(&old.id) {
                predecessor_ids.push(old.id.clone());
            }
        }
        predecessor_ids.retain(|previous| previous != &id);
        let volume = heading.and_then(|line| {
            volumes
                .iter()
                .rev()
                .find(|v| v.line <= line)
                .map(|v| v.id.clone())
        });
        let correction = heading.and_then(|line| {
            corrections
                .iter()
                .find(|c| c.source_id == source.id && c.line == line)
        });
        chapters.push(Chapter {
            id,
            source_id: source.id.clone(),
            title: title.clone(),
            start: *start,
            end,
            heading: *heading,
            volume_id: correction.and_then(|c| c.volume_id.clone()).or(volume),
            predecessor_ids,
        });
    }
    Ok(Detection {
        chapters,
        volumes,
        issues,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source(text: &str) -> Source {
        Source {
            id: "s".into(),
            filename: "book.txt".into(),
            encoding: "utf-8".into(),
            raw_sha256: crate::project::hash(text.as_bytes()),
            sha256: crate::project::hash(text.as_bytes()),
            text: text.into(),
        }
    }
    #[test]
    fn mixed_headings_preserve_prefix_unicode_and_line_endings() {
        let s = source("序言正文\r\n第一卷 旅程\r第一章 夜\n正文😀\r\n第二节 雨\n正文\n尾声\n结束");
        let Detection {
            chapters: c,
            volumes: v,
            ..
        } = detect(&s, &builtin(), &[], &[], &CancellationToken::new()).unwrap();
        assert_eq!(c.len(), 4);
        assert_eq!(v.len(), 1);
        assert_eq!(
            c.iter()
                .map(|c| &s.text[c.start as usize..c.end as usize])
                .collect::<String>(),
            s.text
        );
    }
    #[test]
    fn manual_exclusion_survives_redetection_and_identity_is_stable() {
        let s = source("第一章 开始\n正文\n第二章 后续\n正文");
        let token = CancellationToken::new();
        let Detection { chapters: old, .. } = detect(&s, &builtin(), &[], &[], &token).unwrap();
        let correction = Correction {
            source_id: s.id.clone(),
            line: 2,
            include: false,
            title: None,
            volume_id: None,
        };
        let Detection { chapters: new, .. } =
            detect(&s, &builtin(), &[correction], &old, &token).unwrap();
        assert_eq!(new.len(), 1);
        assert_eq!(new[0].id, old[0].id);
        assert_eq!(new[0].end as usize, s.text.len());
        assert!(new[0].predecessor_ids.contains(&old[1].id));
    }
    #[test]
    fn skipped_number_is_reported_without_inventing_a_chapter() {
        let s = source("第九章 夜\n正文\n第十一章 雨\n正文");
        let Detection {
            chapters, issues, ..
        } = detect(&s, &builtin(), &[], &[], &CancellationToken::new()).unwrap();
        assert_eq!(chapters.len(), 2);
        assert!(
            issues
                .iter()
                .any(|i| i.kind == "numbering_gap" && i.line == 2)
        );
    }
    #[test]
    fn bracketed_numbers_do_not_create_a_false_gap() {
        let s = source("第二章 夜\n正文\n【三】海边\n正文\n第四章 归来\n正文");
        let mut rules = builtin();
        rules.push(HeadingRule {
            name: "括号标题".into(),
            pattern: "^【".into(),
            kind: RuleKind::Chapter,
        });
        let result = detect(&s, &rules, &[], &[], &CancellationToken::new()).unwrap();
        assert_eq!(result.chapters.len(), 3);
        assert!(!result.issues.iter().any(|i| i.kind == "numbering_gap"));
    }
    #[test]
    fn invalid_regex_and_cancellation_are_explicit() {
        let s = source("没有统一标题\n正文");
        let mut rules = builtin();
        rules[0].pattern = "(?<=章)".into();
        assert!(matches!(
            detect(&s, &rules, &[], &[], &CancellationToken::new()),
            Err(ProjectError::InvalidRule)
        ));
        let token = CancellationToken::new();
        token.cancel();
        assert!(matches!(
            detect(&s, &builtin(), &[], &[], &token),
            Err(ProjectError::Cancelled)
        ));
    }
}
