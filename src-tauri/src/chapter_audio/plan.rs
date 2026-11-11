//! 生成前检查与合成单元构建：纯核心（切分、归属解析、阻塞聚合）+ 数据库装配。
//!
//! 单元边界即进度、失败定位与持久化粒度。切分上限按 Kokoro 单次 forward
//! 预算（512 音素 / 30 s 采样）保守取 120 字符；原文不可变，单元字节范围
//! 精确分区每个 segment 范围。
use super::types::*;
use crate::chapter_analysis::{Attribution, ByteRange, Character, Segment, line_at};
use crate::voice_binding::{BindingTarget, BindingView, VoiceRef};
use std::collections::{BTreeSet, HashMap};

/// 单元文本上限（字符，含标点）。约 26 s @ 4.6 字/秒，留出预算余量。
pub(crate) const MAX_UNIT_CHARS: usize = 120;

pub(crate) struct PlannedUnit {
    pub segment_id: String,
    pub range: ByteRange,
    /// 单元起点的源文件行号（零基），用于定位而不重读原文。
    pub line: u32,
    pub target: BindingTarget,
    pub voice: String,
    pub empty: bool,
}

pub(crate) struct Plan {
    pub version_id: String,
    pub source_sha256: String,
    pub backend: String,
    pub model: String,
    pub units: Vec<PlannedUnit>,
}

pub(crate) enum Outcome {
    Blocked(Vec<ChapterAudioBlocker>),
    Ready(Plan),
}

/// 引擎目录事实的纯投影；真实目录由装配层提供。
pub(crate) struct ModelFacts {
    pub ready: bool,
    pub preset: bool,
    pub cpu: bool,
    pub voices: Vec<String>,
    /// 资源状态短标签（Missing/Downloading/...），用于阻塞详情。
    pub state: String,
}

fn is_sentence_end(c: char) -> bool {
    matches!(c, '。' | '！' | '？' | '；' | '…' | '\n' | '!' | '?' | ';')
}

fn is_closer(c: char) -> bool {
    matches!(c, '”' | '』' | '」' | '》' | '）' | '"' | ')' | '’')
}

/// 句读边界切分：单元 ≤ `MAX_UNIT_CHARS` 字符，相邻单元范围连续，拼接等于
/// 整个 segment 范围。无句读边界时在字符边界硬切；整段空白返回单个覆盖范围。
pub(crate) fn split_range(text: &str, range: ByteRange) -> Vec<ByteRange> {
    let Some(slice) = text.get(range.start as usize..range.end as usize) else {
        return vec![range];
    };
    if slice.trim().is_empty() {
        return vec![range];
    }
    // 先标记所有允许的切分点（句末标点及其后引号/括号收尾）。
    let mut allowed: Vec<usize> = Vec::new();
    let mut closable = false;
    for (i, c) in slice.char_indices() {
        // 句末标点开启一个可切点，其后紧跟的收尾引号/括号延续它。
        closable = is_sentence_end(c) || (closable && is_closer(c));
        if closable {
            allowed.push(i + c.len_utf8());
        }
    }
    let mut units: Vec<(usize, usize)> = Vec::new();
    let mut unit_start = 0usize;
    let mut chars = 0usize;
    let mut last_cut = 0usize;
    let mut allowed_from = 0usize;
    for (i, c) in slice.char_indices() {
        chars += 1;
        let char_end = i + c.len_utf8();
        while allowed_from < allowed.len() && allowed[allowed_from] < char_end {
            allowed_from += 1;
        }
        if allowed_from < allowed.len() && allowed[allowed_from] == char_end {
            last_cut = char_end;
            allowed_from += 1;
        }
        if chars >= MAX_UNIT_CHARS {
            let cut = if last_cut > unit_start {
                last_cut
            } else {
                char_end
            };
            units.push((unit_start, cut));
            unit_start = cut;
            // 回退到句读时，切点之后的字符已经扫描过，仍属于下一单元。
            chars = slice[cut..char_end].chars().count();
            last_cut = 0;
        }
    }
    if unit_start < slice.len() {
        if units.is_empty()
            || !slice[unit_start..].trim().is_empty()
            || slice[units.last().expect("non-empty").0..].chars().count() > MAX_UNIT_CHARS
        {
            units.push((unit_start, slice.len()));
        } else {
            // 末尾空白并入上一单元，保持分区精确且不产生空白单元。
            units.last_mut().expect("units checked non-empty").1 = slice.len();
        }
    }
    units
        .into_iter()
        .map(|(start, end)| ByteRange {
            start: range.start + start as u32,
            end: range.start + end as u32,
        })
        .collect()
}

struct Occurrence {
    count: u32,
    range: ByteRange,
    line: u32,
    segment_id: String,
}

fn bump(slot: &mut Option<Occurrence>, segment: &Segment, line: u32) {
    match slot {
        Some(occ) => occ.count += 1,
        None => {
            *slot = Some(Occurrence {
                count: 1,
                range: segment.range.clone(),
                line,
                segment_id: segment.id.clone(),
            });
        }
    }
}

fn names_of(characters: &[Character]) -> HashMap<&str, &str> {
    characters
        .iter()
        .map(|c| (c.id.as_str(), c.display_name.as_str()))
        .collect()
}

/// 纯核心：segments + 绑定 + 目录事实 → 阻塞或合成单元计划。
/// 调用方保证 segments 已通过分析校验（覆盖、边界、角色已知）。
pub(crate) fn assemble(
    text: &str,
    version_id: &str,
    segments: &[Segment],
    characters: &[Character],
    bindings: &[BindingView],
    facts_of: impl Fn(&str, &str) -> Option<ModelFacts>,
) -> Outcome {
    let names = names_of(characters);
    let mut blockers: Vec<ChapterAudioBlocker> = Vec::new();
    let mut unknown = None;
    let mut ambiguous = None;
    // 依首次出现顺序记录每个用到的目标（旁白/角色）。
    let mut used: Vec<(BindingTarget, Occurrence)> = Vec::new();

    for segment in segments {
        let line = line_at(text, segment.range.start);
        match &segment.attribution {
            Attribution::Resolved { character_id } => {
                let target = BindingTarget::Character {
                    character_id: character_id.clone(),
                };
                match used.iter_mut().find(|(t, _)| *t == target) {
                    Some((_, occ)) => occ.count += 1,
                    None => used.push((
                        target,
                        Occurrence {
                            count: 1,
                            range: segment.range.clone(),
                            line,
                            segment_id: segment.id.clone(),
                        },
                    )),
                }
            }
            Attribution::Narrator => match used
                .iter_mut()
                .find(|(t, _)| matches!(t, BindingTarget::Narrator))
            {
                Some((_, occ)) => occ.count += 1,
                None => used.push((
                    BindingTarget::Narrator,
                    Occurrence {
                        count: 1,
                        range: segment.range.clone(),
                        line,
                        segment_id: segment.id.clone(),
                    },
                )),
            },
            Attribution::Unknown => bump(&mut unknown, segment, line),
            Attribution::Ambiguous { .. } => bump(&mut ambiguous, segment, line),
        }
    }

    for (occ, kind) in [
        (unknown, ChapterAudioBlockerKind::UnknownAttribution),
        (ambiguous, ChapterAudioBlockerKind::AmbiguousAttribution),
    ] {
        if let Some(occ) = occ {
            blockers.push(ChapterAudioBlocker {
                kind,
                count: occ.count,
                line: occ.line,
                range: Some(occ.range),
                segment_id: Some(occ.segment_id),
                character_id: None,
                character_name: None,
                detail: None,
            });
        }
    }

    let find_binding = |target: &BindingTarget| bindings.iter().find(|b| &b.target == target);
    let mut combos: BTreeSet<(String, String)> = BTreeSet::new();
    for (target, occ) in &used {
        let character_id = target.character_id().map(str::to_owned);
        let character_name = character_id
            .as_deref()
            .and_then(|id| names.get(id).map(|n| n.to_string()));
        let base = |kind| ChapterAudioBlocker {
            kind,
            count: occ.count,
            line: occ.line,
            range: Some(occ.range.clone()),
            segment_id: Some(occ.segment_id.clone()),
            character_id: character_id.clone(),
            character_name: character_name.clone(),
            detail: None,
        };
        match find_binding(target).and_then(|b| b.voice.as_ref()) {
            None => blockers.push(base(ChapterAudioBlockerKind::MissingBinding)),
            Some(VoiceRef::Library { .. }) => {
                blockers.push(base(ChapterAudioBlockerKind::VoiceNotPreset))
            }
            Some(VoiceRef::Preset { backend, model, .. }) => {
                combos.insert((backend.clone(), model.clone()));
            }
        }
    }

    if blockers.is_empty() && combos.len() > 1 {
        // 组合不一致是工程级条件：列出涉及的组合，不指向单个目标。
        blockers.push(ChapterAudioBlocker {
            kind: ChapterAudioBlockerKind::MixedCombos,
            count: used.len() as u32,
            line: 0,
            range: None,
            segment_id: None,
            character_id: None,
            character_name: None,
            detail: Some(
                combos
                    .iter()
                    .map(|(backend, model)| format!("{backend}/{model}"))
                    .collect::<Vec<_>>()
                    .join("、"),
            ),
        });
    }

    if blockers.is_empty() {
        let (backend, model) = combos
            .iter()
            .next()
            .cloned()
            .expect("non-empty chapter resolves at least one combo");
        let combo = format!("{backend}/{model}");
        match facts_of(&backend, &model) {
            None => blockers.push(ChapterAudioBlocker {
                kind: ChapterAudioBlockerKind::ResourceNotReady,
                count: 1,
                line: 0,
                range: None,
                segment_id: None,
                character_id: None,
                character_name: None,
                detail: Some(combo),
            }),
            Some(facts) => {
                let project_level = |detail: String| ChapterAudioBlocker {
                    kind: ChapterAudioBlockerKind::ResourceNotReady,
                    count: 1,
                    line: 0,
                    range: None,
                    segment_id: None,
                    character_id: None,
                    character_name: None,
                    detail: Some(format!("{combo}（{detail}）")),
                };
                if !facts.ready {
                    blockers.push(project_level(facts.state));
                } else if !facts.preset {
                    blockers.push(project_level("无预置音色".into()));
                } else if !facts.cpu {
                    blockers.push(project_level("无可用 CPU 设备".into()));
                } else {
                    for (target, occ) in &used {
                        let Some(VoiceRef::Preset { voice, .. }) =
                            find_binding(target).and_then(|b| b.voice.as_ref())
                        else {
                            continue;
                        };
                        if !facts.voices.iter().any(|v| v == voice) {
                            blockers.push(ChapterAudioBlocker {
                                kind: ChapterAudioBlockerKind::VoiceMissing,
                                count: occ.count,
                                line: occ.line,
                                range: Some(occ.range.clone()),
                                segment_id: Some(occ.segment_id.clone()),
                                character_id: target.character_id().map(str::to_owned),
                                character_name: target
                                    .character_id()
                                    .and_then(|id| names.get(id).map(|n| n.to_string())),
                                detail: Some(format!("{combo}/{voice}")),
                            });
                        }
                    }
                }
            }
        }
    }

    if !blockers.is_empty() {
        return Outcome::Blocked(blockers);
    }

    let (backend, model) = combos
        .iter()
        .next()
        .cloned()
        .expect("blocked paths return earlier");
    let voice_of = |target: &BindingTarget| -> String {
        let Some(VoiceRef::Preset { voice, .. }) =
            find_binding(target).and_then(|b| b.voice.as_ref())
        else {
            unreachable!("blocked paths cover unbound and non-preset targets")
        };
        voice.clone()
    };
    let mut units = Vec::new();
    for segment in segments {
        let target = match &segment.attribution {
            Attribution::Resolved { character_id } => BindingTarget::Character {
                character_id: character_id.clone(),
            },
            _ => BindingTarget::Narrator,
        };
        let voice = voice_of(&target);
        for range in split_range(text, segment.range.clone()) {
            let empty = text
                .get(range.start as usize..range.end as usize)
                .is_none_or(|s| s.trim().is_empty());
            units.push(PlannedUnit {
                segment_id: segment.id.clone(),
                line: line_at(text, range.start),
                range,
                target: target.clone(),
                voice: voice.clone(),
                empty,
            });
        }
    }
    Outcome::Ready(Plan {
        version_id: version_id.to_owned(),
        source_sha256: String::new(),
        backend,
        model,
        units,
    })
}

#[cfg(test)]
mod tests;

use crate::chapter_analysis::{AnalysisError, validate_analysis};
use sea_orm::ConnectionTrait;
use std::path::Path;

impl From<AnalysisError> for ChapterAudioError {
    fn from(error: AnalysisError) -> Self {
        match error {
            AnalysisError::NotFound => Self::NotFound,
            AnalysisError::ReadFailed => Self::ReadFailed,
            AnalysisError::SourceChanged | AnalysisError::InvalidData | AnalysisError::Conflict => {
                Self::InvalidData
            }
            _ => Self::ReadFailed,
        }
    }
}

impl From<crate::voice_binding::BindingError> for ChapterAudioError {
    fn from(_: crate::voice_binding::BindingError) -> Self {
        Self::ReadFailed
    }
}

fn resource_state_label(state: &crate::engine::ResourceState) -> String {
    match serde_json::to_value(state) {
        Ok(serde_json::Value::String(label)) => label,
        Ok(serde_json::Value::Object(map)) => map
            .keys()
            .next()
            .cloned()
            .unwrap_or_else(|| "Unknown".into()),
        _ => "Unknown".into(),
    }
}

/// 装配：采用分析 + 不可变来源 + 绑定 + 引擎目录 → 阻塞或计划。
/// 在 blocking 上下文调用（读来源文件与磁盘盘点）。
pub(crate) async fn build(
    db: &impl ConnectionTrait,
    root: &Path,
    engine: &crate::engine::EngineState,
    project_id: &str,
    chapter_id: &str,
) -> Result<Outcome, ChapterAudioError> {
    let binding = crate::chapter_analysis::analysis_binding(db, project_id, chapter_id).await?;
    let text = crate::chapter_analysis::read_analysis_text(root, &binding)?;
    let Some(state) = crate::chapter_analysis::analysis_state(db, project_id, chapter_id).await?
    else {
        return Ok(Outcome::Blocked(vec![ChapterAudioBlocker {
            kind: ChapterAudioBlockerKind::NoAnalysis,
            count: 1,
            line: 0,
            range: None,
            segment_id: None,
            character_id: None,
            character_name: None,
            detail: None,
        }]));
    };
    let version =
        crate::chapter_analysis::analysis_version(db, project_id, &state.current_version_id)
            .await?;
    if version.dependencies.source != binding {
        return Ok(Outcome::Blocked(vec![ChapterAudioBlocker {
            kind: ChapterAudioBlockerKind::AnalysisInvalid,
            count: 1,
            line: 0,
            range: None,
            segment_id: None,
            character_id: None,
            character_name: None,
            detail: Some("分析版本基于较早的章节范围，请重新分析".into()),
        }]));
    }
    let characters = crate::chapter_analysis::analysis_characters(db, project_id).await?;
    if validate_analysis(&version, &text, &characters).is_err() {
        return Ok(Outcome::Blocked(vec![ChapterAudioBlocker {
            kind: ChapterAudioBlockerKind::AnalysisInvalid,
            count: 1,
            line: 0,
            range: None,
            segment_id: None,
            character_id: None,
            character_name: None,
            detail: Some("分析版本未通过覆盖完整性校验".into()),
        }]));
    }
    let bindings = crate::voice_binding::project_bindings(db, project_id).await?;
    let entries =
        crate::engine::catalog::list_models(engine).map_err(|_| ChapterAudioError::ReadFailed)?;
    let facts = |backend: &str, model: &str| -> Option<ModelFacts> {
        let entry = entries
            .iter()
            .find(|e| e.backend == backend && e.model == model)?;
        Some(ModelFacts {
            ready: matches!(entry.resource, crate::engine::ResourceState::Ready),
            preset: entry.capabilities.preset,
            cpu: entry
                .available_devices
                .contains(&crate::engine::InferenceDevice::Cpu),
            voices: entry.voice_catalog.iter().map(|v| v.id.clone()).collect(),
            state: resource_state_label(&entry.resource),
        })
    };
    Ok(
        match assemble(
            &text,
            &version.id,
            &version.segments,
            &characters,
            &bindings,
            facts,
        ) {
            Outcome::Blocked(blockers) => Outcome::Blocked(blockers),
            Outcome::Ready(mut plan) => {
                plan.source_sha256 = binding.sha256;
                Outcome::Ready(plan)
            }
        },
    )
}

impl Plan {
    pub(crate) fn summary(&self) -> ChapterAudioPlanSummary {
        ChapterAudioPlanSummary {
            backend: self.backend.clone(),
            model: self.model.clone(),
            unit_count: self.units.len() as u32,
            narration_units: self
                .units
                .iter()
                .filter(|u| matches!(u.target, BindingTarget::Narrator))
                .count() as u32,
            character_count: self
                .units
                .iter()
                .filter_map(|u| u.target.character_id())
                .collect::<BTreeSet<_>>()
                .len() as u32,
        }
    }
}
