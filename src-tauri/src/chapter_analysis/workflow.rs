//! Historical evaluation baseline, never the default product route: shared identities, bounded annotation fan-out, read-only review.
use super::{
    compact, execution, input,
    journal::{self, Call, Journal, RequestLimits},
    precut, query, store,
    types::*,
    validation,
};
use crate::ai::{RunFailure, output::Output, runs::Lease};
use futures_util::{StreamExt, stream};
use rig_core::{
    DynModel,
    completion::{CompletionRequest, Effort, GenerationOptions},
    operation::Completion,
};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, ops::Range, path::Path, time::Instant};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize, Deserialize)]
struct Annotation {
    segments: Vec<Segment>,
    wire: Value,
}

pub(crate) async fn execute_configured(
    db: &DatabaseConnection,
    root: &Path,
    lease: &Lease,
    model: DynModel<Completion>,
    capacity: (Option<u32>, Option<u32>),
    token: &CancellationToken,
    limits: RequestLimits,
) -> Result<(), RunFailure> {
    let input = input::read(db, lease.run_id())
        .await
        .map_err(|_| RunFailure::StorageFailed)?;
    if input.protocol == 0 || input.action == input::Action::Discuss {
        return execution::execute(
            db,
            root,
            lease,
            model,
            capacity.0,
            capacity.1,
            json!({}),
            token,
        )
        .await;
    }
    if input.prompt_version.as_deref() != Some(compact::PROMPT_VERSION) {
        return Err(RunFailure::StaleProject);
    }
    let output = Output::resume(db.clone(), lease.clone())
        .await
        .map_err(|_| RunFailure::StorageFailed)?;
    let configuration_hash = hash(
        &json!({"configuration":input.configuration,"capacity":capacity,"model":limits.model,
        "reasoning":"low"}),
    );
    let journal = Journal {
        db: db.clone(),
        lease: lease.clone(),
        origin: input
            .resume_input_id
            .clone()
            .unwrap_or_else(|| lease.run_id().into()),
        output,
        limits,
        token: token.child_token(),
        configuration_hash,
        source_hash: input.dependencies.source.sha256.clone(),
        explicit_resume: input.resume_input_id.is_some(),
    };
    let began = Instant::now();
    let wall = journal::millis();
    let prepare = async {
        let path = root.to_owned();
        let source = input.dependencies.source.clone();
        let text = tauri::async_runtime::spawn_blocking(move || query::read_text(&path, &source))
            .await
            .map_err(|_| RunFailure::StorageFailed)?
            .map_err(execution::failure)?;
        store::check_dependencies(
            db,
            &input.dependencies,
            input.dependencies.analysis_revision != 0,
        )
        .await
        .map_err(execution::failure)?;
        let pieces =
            precut::partition(&text, &input.dependencies.source).map_err(execution::failure)?;
        Ok::<_, RunFailure>((text, pieces))
    }
    .await;
    journal
        .record_local(
            "prepare",
            wall,
            began.elapsed().as_millis() as u64,
            prepare.as_ref().err().copied(),
        )
        .await?;
    let (text, pieces) = prepare?;
    let outcome = run(&journal, &input, &model, &pieces, &text, capacity, root).await;
    if outcome.is_err() {
        journal.token.cancel();
    }
    outcome
}

fn hash(value: &Value) -> String {
    crate::project::hash(value.to_string().as_bytes())
}

pub(super) fn request(
    prompt: &str,
    payload: Value,
    schema: schemars::Schema,
    max_output: Option<u32>,
) -> CompletionRequest {
    let mut request = CompletionRequest::new(payload.to_string())
        .preamble(prompt)
        .output_schema(schema)
        .options(GenerationOptions::new().reasoning(Effort::Low));
    if let Some(max) = max_output {
        request = request.max_tokens(u64::from(max));
    }
    request
}

pub(super) fn identities(input: &input::Input, local: &BTreeMap<String, Character>) -> Value {
    json!({"confirmedCharacters":input.characters.iter().enumerate().map(|(i,c)|json!({"key":format!("c{i}"),"name":c.display_name,
        "source":c.origin,"evidence":c.evidence})).collect::<Vec<_>>(),
        "confirmedAliases":input.aliases.iter().map(|a|json!({"key":input.characters.iter().position(|c|c.id==a.character_id).map(|i|format!("c{i}")),
            "name":a.name,"source":a.source,"evidence":a.evidence})).collect::<Vec<_>>(),
        "localCandidates":local.iter().map(|(key,c)|json!({"key":key,"name":c.display_name,"evidence":c.evidence})).collect::<Vec<_>>()})
}

type PieceGroup = (Range<usize>, Range<usize>);

/// Explicit capacity narrows read-only windows; unknown capacity is not invented as 8K.
fn groups(pieces: &[precut::Piece], capacity: Option<u32>) -> Result<Vec<PieceGroup>, RunFailure> {
    let budget = capacity.map(|n| (n as usize).saturating_sub(2048) / 2);
    if budget == Some(0) {
        return Err(RunFailure::ConfigurationUnavailable);
    }
    let mut ranges = Vec::new();
    let mut start = 0;
    let mut scalars = 0;
    for (i, p) in pieces.iter().enumerate() {
        let n = p.text.chars().count();
        if budget.is_some_and(|b| n > b) {
            return Err(RunFailure::ConfigurationUnavailable);
        }
        if i > start && budget.is_some_and(|b| scalars + n > b) {
            ranges.push(start..i);
            start = i;
            scalars = 0;
        }
        scalars += n;
    }
    ranges.push(start..pieces.len());
    if ranges.len() == 1 && pieces.len() > 1 {
        let middle = pieces.len() / 2;
        ranges = vec![0..middle, middle..pieces.len()];
    }
    Ok(ranges
        .into_iter()
        .map(|owned| {
            let visible = if budget.is_none()
                || pieces.iter().map(|p| p.text.chars().count()).sum::<usize>()
                    <= budget.unwrap_or(usize::MAX)
            {
                0..pieces.len()
            } else {
                owned.clone()
            };
            (owned, visible)
        })
        .collect())
}

async fn run(
    journal: &Journal,
    input: &input::Input,
    model: &DynModel<Completion>,
    pieces: &[precut::Piece],
    text: &str,
    capacity: (Option<u32>, Option<u32>),
    root: &Path,
) -> Result<(), RunFailure> {
    let binding = &input.dependencies.source;
    let plan = groups(pieces, capacity.0)?;
    let (local, identity_key) = discover(journal, input, model, pieces, &plan, capacity.1).await?;
    let mut tasks = Vec::new();
    for (i, (owned, visible)) in plan.iter().enumerate() {
        let schema =
            compact::owned_analysis_schema(&pieces[owned.clone()], &input.characters, &local)
                .map_err(execution::failure)?;
        let payload = json!({"targets":&pieces[owned.clone()],"contextPieces":&pieces[visible.clone()],"owned":pieces[owned.clone()].iter().map(|p|&p.id).collect::<Vec<_>>(),
            "context":identities(input,&local),"outputSchema":schema});
        let key = hash(
            &json!({"identity":identity_key,"roles":local,"prompt":compact::ANALYSIS_PROMPT,"payload":payload}),
        );
        tasks.push((i as i32, owned.clone(), visible.clone(), payload, key));
    }
    journal
        .plan(
            &tasks
                .iter()
                .map(|(i, _, _, _, key)| (*i, "analysis".into(), key.clone()))
                .collect::<Vec<_>>(),
        )
        .await?;
    let parts = stream::iter(tasks)
        .map(|(ordinal, owned, visible, payload, key)| {
            let local = &local;
            async move {
                store::check_dependencies(
                    &journal.db,
                    &input.dependencies,
                    input.dependencies.analysis_revision != 0,
                )
                .await
                .map_err(execution::failure)?;
                journal
                    .call(
                        Call {
                            ordinal,
                            stage: "analysis",
                            fingerprint: &key,
                            prompt: compact::ANALYSIS_PROMPT,
                            version: compact::PROMPT_VERSION,
                            model,
                            request: request(
                                compact::ANALYSIS_PROMPT,
                                payload,
                                compact::owned_analysis_schema(
                                    &pieces[owned.clone()],
                                    &input.characters,
                                    local,
                                )
                                .map_err(execution::failure)?,
                                capacity.1,
                            ),
                        },
                        |value| {
                            visible_evidence(&value, "segments", visible.clone())?;
                            Ok(Annotation {
                                segments: compact::decode_analysis(
                                    value.clone(),
                                    pieces,
                                    owned,
                                    binding,
                                    &input.characters,
                                    local,
                                )
                                .map_err(execution::failure)?,
                                wire: value,
                            })
                        },
                    )
                    .await
                    .map(|part| (ordinal, part))
            }
        })
        .buffer_unordered(2)
        .map(|result| {
            if result.is_err() {
                journal.token.cancel();
            }
            result
        })
        .collect::<Vec<_>>()
        .await;
    let mut annotations = parts.into_iter().collect::<Result<Vec<_>, _>>()?;
    annotations.sort_by_key(|(ordinal, _)| *ordinal);
    let segments = annotations
        .iter()
        .flat_map(|(_, a)| a.segments.clone())
        .collect::<Vec<_>>();
    let wall = journal::millis();
    let started = Instant::now();
    let version = AnalysisVersion {
        format_version: 1,
        id: "compact-validation".into(),
        parent_id: None,
        run_id: Some(journal.lease.run_id().into()),
        dependencies: input.dependencies.clone(),
        segments: segments.clone(),
        protections: vec![],
    };
    let validation = validation::validate(
        &version,
        text,
        &input
            .characters
            .iter()
            .chain(local.values())
            .cloned()
            .collect::<Vec<_>>(),
    )
    .map_err(execution::failure);
    journal
        .record_local(
            "validation",
            wall,
            started.elapsed().as_millis() as u64,
            validation.as_ref().err().copied(),
        )
        .await?;
    validation?;
    review(
        journal,
        input,
        model,
        pieces,
        &local,
        &annotations,
        &plan,
        capacity.1,
    )
    .await?;
    let path = root.to_owned();
    let source = binding.clone();
    let latest = tauri::async_runtime::spawn_blocking(move || query::read_text(&path, &source))
        .await
        .map_err(|_| RunFailure::StorageFailed)?
        .map_err(execution::failure)?;
    if latest != text {
        return Err(RunFailure::StaleProject);
    }
    // Publication uses the same source/dependency/human protection transaction as the original path.
    let started = Instant::now();
    let wall = journal::millis();
    let result = execution::publish_observed(
        &journal.db,
        &journal.lease,
        input,
        segments,
        local.into_values().collect(),
        text,
        &journal.output,
        Some(execution::Publication {
            journal,
            started,
            started_at: wall,
        }),
    )
    .await;
    if let Err(error) = result {
        journal
            .record_local(
                "publish",
                wall,
                started.elapsed().as_millis() as u64,
                Some(error),
            )
            .await?;
    }
    result
}

#[cfg(test)]
mod tests;

fn visible_evidence(value: &Value, field: &str, visible: Range<usize>) -> Result<(), RunFailure> {
    for item in value[field].as_array().ok_or(RunFailure::InvalidResponse)? {
        for id in item["evidence"]
            .as_array()
            .ok_or(RunFailure::InvalidResponse)?
        {
            let index = id
                .as_str()
                .and_then(|s| s.strip_prefix('s'))
                .and_then(|s| s.parse::<usize>().ok())
                .ok_or(RunFailure::InvalidResponse)?;
            if !visible.contains(&index) {
                return Err(RunFailure::InvalidResponse);
            }
        }
    }
    Ok(())
}

async fn discover(
    journal: &Journal,
    input: &input::Input,
    model: &DynModel<Completion>,
    pieces: &[precut::Piece],
    plan: &[(Range<usize>, Range<usize>)],
    max_output: Option<u32>,
) -> Result<(BTreeMap<String, Character>, String), RunFailure> {
    let binding = &input.dependencies.source;
    let windows = if plan
        .iter()
        .all(|(_, visible)| *visible == (0..pieces.len()))
    {
        std::iter::once(0..pieces.len()).collect::<Vec<_>>()
    } else {
        plan.iter().map(|(owned, _)| owned.clone()).collect()
    };
    let mut local = BTreeMap::new();
    let mut fingerprints = Vec::new();
    for (i, visible) in windows.iter().enumerate() {
        let next = local.len();
        let payload = json!({"targets":&pieces[visible.clone()],"context":identities(input,&local),"nextNewKey":next,
            "outputSchema":compact::role_schema()});
        let key = hash(
            &json!({"source":binding,"configuration":journal.configuration_hash,"scope":journal.limits.discover_roles,
            "prompt":compact::IDENTITY_PROMPT,"protocol":compact::PROTOCOL_VERSION,"payload":payload}),
        );
        let ordinal = if i == 0 { -2 } else { -1000 - i as i32 };
        journal
            .plan(&[(ordinal, "identity".into(), key.clone())])
            .await?;
        let found: BTreeMap<String, Character> = if journal.limits.discover_roles {
            journal
                .call(
                    Call {
                        ordinal,
                        stage: "identity",
                        fingerprint: &key,
                        prompt: compact::IDENTITY_PROMPT,
                        version: compact::PROMPT_VERSION,
                        model,
                        request: request(
                            compact::IDENTITY_PROMPT,
                            payload,
                            compact::role_schema(),
                            max_output,
                        ),
                    },
                    |value| {
                        visible_evidence(&value, "characters", visible.clone())?;
                        let found =
                            compact::decode_roles(value, pieces, binding, &input.characters)
                                .map_err(execution::failure)?;
                        if (next..next + found.len())
                            .any(|n| !found.contains_key(&format!("new:{n}")))
                        {
                            return Err(RunFailure::InvalidResponse);
                        }
                        Ok(found)
                    },
                )
                .await?
        } else {
            journal
                .local_result(ordinal, "identity", &key, BTreeMap::new())
                .await?
        };
        for (key, c) in found {
            if local.insert(key, c).is_some() {
                return Err(RunFailure::InvalidResponse);
            }
        }
        fingerprints.push(key);
    }
    Ok((local, hash(&json!(fingerprints))))
}

#[expect(
    clippy::too_many_arguments,
    reason = "review binds the same validated plan, identities and annotations"
)]
async fn review(
    journal: &Journal,
    input: &input::Input,
    model: &DynModel<Completion>,
    pieces: &[precut::Piece],
    local: &BTreeMap<String, Character>,
    annotations: &[(i32, Annotation)],
    plan: &[(Range<usize>, Range<usize>)],
    max_output: Option<u32>,
) -> Result<(), RunFailure> {
    let windows = if plan
        .iter()
        .all(|(_, visible)| *visible == (0..pieces.len()))
    {
        std::iter::once(0..pieces.len()).collect::<Vec<_>>()
    } else {
        plan.iter().map(|(owned, _)| owned.clone()).collect()
    };
    let mut combined = compact::Review {
        issues: vec![],
        summary: String::new(),
    };
    let mut fingerprints = Vec::new();
    for (i, visible) in windows.iter().enumerate() {
        let wire = annotations
            .iter()
            .filter(|(ordinal, _)| windows.len() == 1 || (*ordinal as usize) == i)
            .flat_map(|(_, a)| a.wire["segments"].as_array().into_iter().flatten().cloned())
            .collect::<Vec<_>>();
        let payload = json!({"targets":&pieces[visible.clone()],"owned":pieces[visible.clone()].iter().map(|p|&p.id).collect::<Vec<_>>(),
            "context":identities(input,local),"annotations":wire,"outputSchema":compact::review_schema()});
        let key = hash(
            &json!({"payload":payload,"prompt":compact::REVIEW_PROMPT,"configuration":journal.configuration_hash}),
        );
        let ordinal = if windows.len() == 1 {
            -1
        } else {
            -10000 - i as i32
        };
        journal
            .plan(&[(ordinal, "review".into(), key.clone())])
            .await?;
        let result: compact::Review = journal
            .call(
                Call {
                    ordinal,
                    stage: "review",
                    fingerprint: &key,
                    prompt: compact::REVIEW_PROMPT,
                    version: compact::PROMPT_VERSION,
                    model,
                    request: request(
                        compact::REVIEW_PROMPT,
                        payload,
                        compact::review_schema(),
                        max_output,
                    ),
                },
                |value| {
                    let result = compact::validate_review(value, pieces, &input.characters, local)
                        .map_err(execution::failure)?;
                    if result
                        .issues
                        .iter()
                        .flat_map(|issue| &issue.target_ids)
                        .any(|id| {
                            id.strip_prefix('s')
                                .and_then(|s| s.parse::<usize>().ok())
                                .is_none_or(|n| !visible.contains(&n))
                        })
                    {
                        return Err(RunFailure::InvalidResponse);
                    }
                    Ok(result)
                },
            )
            .await?;
        combined.issues.extend(result.issues);
        if !combined.summary.is_empty() {
            combined.summary.push('\n');
        }
        combined.summary.push_str(&result.summary);
        fingerprints.push(key);
    }
    if windows.len() > 1 {
        let key = hash(&json!(fingerprints));
        journal.plan(&[(-1, "review".into(), key.clone())]).await?;
        let _: compact::Review = journal.local_result(-1, "review", &key, combined).await?;
    }
    Ok(())
}
