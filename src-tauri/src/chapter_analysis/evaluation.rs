//! Opt-in evaluation adapter uses a temporary project and the real production workflow.
use super::{
    compact, input,
    journal::{self, Call, Journal, RequestLimits},
    precut, query,
    types::*,
    validation, workflow,
};
use crate::{
    ai::{self, CreateSession, StartRun, Trigger, runs},
    database::entity::character,
};
use sea_orm::{ActiveModelTrait, Set};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc, time::Instant};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

pub(super) async fn evaluate(job: &Value) -> Value {
    let case = &job["case"];
    assert!(
        case.get("gold").is_none() && case.get("reviewGold").is_none(),
        "gold cannot enter the model adapter"
    );
    let text = case["source"]["text"].as_str().unwrap();
    assert_eq!(
        crate::project::hash(text.as_bytes()),
        case["source"]["sha256"].as_str().unwrap()
    );
    let binding = crate::llm::test_support::experiment_binding(job);
    let (root, db, mut project) = crate::project::test_support::fixture().await;
    let source = &mut project.document.project.sources[0];
    source.text = text.into();
    source.sha256 = crate::project::hash(text.as_bytes());
    source.raw_sha256 = source.sha256.clone();
    crate::project::publish_source(root.path(), source, text.as_bytes()).unwrap();
    project.document.project.chapters[0].end = text.len() as u32;
    crate::project::store::save(&db, root.path(), &project, None)
        .await
        .unwrap();
    let source = query::binding(&db, "project", "chapter").await.unwrap();
    for c in case["characters"].as_array().unwrap() {
        let character = Character {
            id: c["id"].as_str().unwrap().into(),
            project_id: "project".into(),
            display_name: c["name"].as_str().unwrap().into(),
            status: CharacterStatus::Confirmed,
            revision: 1,
            origin: source.clone(),
            evidence: vec![Evidence {
                range: ByteRange {
                    start: 0,
                    end: source.end,
                },
                reason: "公开评测提供的规范身份".into(),
            }],
        };
        character::ActiveModel {
            id: Set(character.id.clone()),
            project_id: Set("project".into()),
            display_name: Set(character.display_name.clone()),
            status: Set("confirmed".into()),
            revision: Set(1),
            content: Set(serde_json::to_value(character).unwrap()),
        }
        .insert(&db)
        .await
        .unwrap();
    }
    let session = ai::create_session(
        &db,
        CreateSession {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: "project".into(),
            chapter_id: Some("chapter".into()),
            task_kind: "chapter_analysis".into(),
            title: "固定公开评测".into(),
        },
    )
    .await
    .unwrap();
    let run = ai::start_analysis_run(
        &db,
        StartRun {
            workspace_context: None,
            session_id: session.id,
            request_id: uuid::Uuid::new_v4().to_string(),
            configuration: binding.configuration.clone(),
            confirm_rebind: false,
            expected_project_revision: 1,
            trigger: Trigger::Message {
                message: "固定评测".into(),
            },
        },
    )
    .await
    .unwrap();
    let lease = runs::claim(&db, &run.id, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap()
        .unwrap();
    let input = input::read(&db, &run.id).await.unwrap();
    let mut limits = RequestLimits::new(Arc::new(Semaphore::new(4)), binding.model_id.clone());
    // Public fixed-identity scoring keeps discovery off; an explicitly authorized
    // private production smoke can exercise the complete identity stage.
    limits.discover_roles = job["discoverRoles"].as_bool().unwrap_or(false);
    let token = CancellationToken::new();
    let started = Instant::now();
    let mut review_result = None;
    let outcome = if case["evaluationTask"] == "review" {
        let j=Journal {db:db.clone(),lease:lease.clone(),origin:run.id.clone(),output:ai::output::Output::new(db.clone(),lease.clone()),limits:limits.clone(),token:token.clone(),
            configuration_hash:crate::project::hash(json!({"configuration":binding.configuration,"capacity":binding.capacity,"model":binding.model_id,"reasoning":"low"}).to_string().as_bytes()),
            source_hash:source.sha256.clone(),explicit_resume:false};
        review_only(case, &input, &j, &binding.model)
            .await
            .map(|review| {
                review_result = Some(review);
            })
    } else {
        workflow::execute_configured(
            &db,
            root.path(),
            &lease,
            binding.model.clone(),
            binding.capacity,
            &token,
            limits,
        )
        .await
    };
    if let Err(error) = outcome {
        runs::finish(&db, &lease, ai::RunStatus::Failed, Some(error))
            .await
            .unwrap();
    }
    if case["evaluationTask"] == "review" && outcome.is_ok() {
        runs::finish(&db, &lease, ai::RunStatus::Succeeded, None)
            .await
            .unwrap();
    }
    let diagnostic = journal::diagnostics(&db, &run.id).await.unwrap();
    let segments = if case["evaluationTask"] == "review" {
        case["reviewInput"]["segments"].clone()
    } else if outcome.is_ok() {
        let snapshot = query::snapshot(&db, root.path(), "project", "chapter")
            .await
            .unwrap();
        let version = query::version(&db, "project", snapshot.version_id.as_deref().unwrap())
            .await
            .unwrap();
        json!(version.segments.iter().map(normalize).collect::<Vec<_>>())
    } else {
        json!([])
    };
    json!({"version":1,"caseId":case["caseId"],"route":"recommended","mode":"live",
        "status":if outcome.is_ok(){"completed"}else{"failed"},"error":outcome.err(),"segments":segments,
        "review":review_result.unwrap_or_else(||json!({"status":"not_requested","issues":[]})),
        "trace":diagnostic,"elapsedMs":started.elapsed().as_millis(),
        "identityScope":if job["discoverRoles"] == true {"discovered-roles-unscored"}else{"provided-known-roles"}})
}

fn normalize(s: &Segment) -> Value {
    let (speaker, candidates) = match &s.attribution {
        Attribution::Narrator => ("narrator".to_owned(), vec![]),
        Attribution::Unknown => ("unknown".into(), vec![]),
        Attribution::Resolved { character_id } => (character_id.clone(), vec![]),
        Attribution::Ambiguous { character_ids } => ("unknown".into(), character_ids.clone()),
    };
    let mut value = json!({"start":s.range.start,"end":s.range.end,"kind":s.kind,"speaker":speaker,
        "evidence":s.evidence.iter().map(|e|json!({"start":e.range.start,"end":e.range.end})).collect::<Vec<_>>()});
    if !candidates.is_empty() {
        value["candidates"] = json!(candidates);
    }
    value
}

async fn review_only(
    case: &Value,
    input: &input::Input,
    journal: &Journal,
    model: &rig_core::DynModel<rig_core::operation::Completion>,
) -> Result<Value, ai::RunFailure> {
    let source = &input.dependencies.source;
    let text = case["source"]["text"].as_str().unwrap();
    let base = precut::partition(text, source).map_err(super::execution::failure)?;
    let mut pieces = Vec::new();
    let mut segments = Vec::new();
    let mut annotations = Vec::new();
    for (i, value) in case["reviewInput"]["segments"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
    {
        let start = value["start"].as_u64().unwrap() as u32;
        let end = value["end"].as_u64().unwrap() as u32;
        let owned = text
            .get(start as usize..end as usize)
            .ok_or(ai::RunFailure::InvalidResponse)?;
        let speaker = value["speaker"].as_str().unwrap();
        let who = if value["candidates"].is_array() {
            value["candidates"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| short_key(c.as_str().unwrap(), &input.characters))
                .collect::<Result<Vec<_>, _>>()?
        } else {
            vec![short_key(speaker, &input.characters)?]
        };
        let attribution = if value["candidates"].is_array() {
            Attribution::Ambiguous {
                character_ids: serde_json::from_value(value["candidates"].clone()).unwrap(),
            }
        } else {
            match speaker {
                "narrator" => Attribution::Narrator,
                "unknown" => Attribution::Unknown,
                other => Attribution::Resolved {
                    character_id: other.into(),
                },
            }
        };
        let kind: SegmentKind = serde_json::from_value(value["kind"].clone())
            .map_err(|_| ai::RunFailure::InvalidResponse)?;
        let quote_depth = base
            .iter()
            .find(|p| p.range.start <= start && p.range.end > start)
            .map_or(0, |p| p.quote_depth);
        pieces.push(precut::Piece {
            id: format!("s{i}"),
            range: ByteRange { start, end },
            text: owned.into(),
            quote_depth,
            utterance: None,
        });
        segments.push(Segment {
            id: format!("candidate-{i}"),
            range: ByteRange { start, end },
            kind,
            attribution,
            review: ReviewStatus::Unreviewed,
            evidence: vec![Evidence {
                range: ByteRange { start, end },
                reason: "评测提供的待审阅候选".into(),
            }],
            reason: "评测提供的待审阅候选".into(),
        });
        annotations.push(
            json!({"from":format!("s{i}"),"to":format!("s{i}"),"kind":kind,"who":who,
            "evidence":[format!("s{i}")],"reason":"评测提供的待审阅候选"}),
        );
    }
    validation::validate(
        &AnalysisVersion {
            format_version: 1,
            id: "review-input".into(),
            parent_id: None,
            run_id: None,
            dependencies: input.dependencies.clone(),
            segments,
            protections: vec![],
        },
        text,
        &input.characters,
    )
    .map_err(super::execution::failure)?;
    let payload = json!({"targets":pieces,"context":workflow::identities(input,&BTreeMap::new()),"annotations":annotations,"outputSchema":compact::review_schema()});
    let key = crate::project::hash(payload.to_string().as_bytes());
    journal.plan(&[(-1, "review".into(), key.clone())]).await?;
    let review: compact::Review = journal
        .call(
            Call {
                ordinal: -1,
                stage: "review",
                fingerprint: &key,
                prompt: compact::REVIEW_PROMPT,
                version: compact::PROMPT_VERSION,
                model,
                request: workflow::request(
                    compact::REVIEW_PROMPT,
                    payload,
                    compact::review_schema(),
                    None,
                ),
            },
            |value| {
                compact::validate_review(value, &pieces, &input.characters, &BTreeMap::new())
                    .map_err(super::execution::failure)
            },
        )
        .await?;
    let mut issues = Vec::new();
    for issue in review.issues {
        for id in issue.target_ids {
            let index = id
                .strip_prefix('s')
                .and_then(|s| s.parse::<usize>().ok())
                .ok_or(ai::RunFailure::InvalidResponse)?;
            let piece = &pieces[index];
            let candidate = &case["reviewInput"]["segments"][index];
            let mut suggestion = json!({"kind":issue.suggested_kind.map_or_else(||candidate["kind"].clone(),|kind|json!(kind)),"speaker":candidate["speaker"]});
            if !issue.suggested_who.is_empty() {
                let keys = issue
                    .suggested_who
                    .iter()
                    .map(|key| canonical_key(key, &input.characters))
                    .collect::<Result<Vec<_>, _>>()?;
                suggestion["speaker"] = if keys.len() == 1 {
                    json!(keys[0])
                } else {
                    json!("unknown")
                };
                if keys.len() > 1 {
                    suggestion["candidates"] = json!(keys);
                }
            } else if candidate["candidates"].is_array() {
                suggestion["candidates"] = candidate["candidates"].clone();
            }
            issues.push(json!({"start":piece.range.start,"end":piece.range.end,"suggestion":suggestion,"certainty":issue.certainty}));
        }
    }
    Ok(json!({"status":"completed","issues":issues}))
}

fn short_key(id: &str, known: &[Character]) -> Result<String, ai::RunFailure> {
    if ["narrator", "unknown"].contains(&id) {
        return Ok(id.into());
    }
    known
        .iter()
        .position(|c| c.id == id)
        .map(|i| format!("c{i}"))
        .ok_or(ai::RunFailure::InvalidResponse)
}
fn canonical_key(key: &str, known: &[Character]) -> Result<String, ai::RunFailure> {
    if ["narrator", "unknown"].contains(&key) {
        return Ok(key.into());
    }
    key.strip_prefix('c')
        .and_then(|s| s.parse::<usize>().ok())
        .and_then(|i| known.get(i))
        .map(|c| c.id.clone())
        .ok_or(ai::RunFailure::InvalidResponse)
}
