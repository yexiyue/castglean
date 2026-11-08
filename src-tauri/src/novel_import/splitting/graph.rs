//! Private graph checkpoints. Tool facts remain authoritative in shared messages.
use super::{execution, tools::SplitTools};
use crate::{
    ai::{self, AiError, RunFailure, runs::Lease},
    database::entity::{ai_run, ai_session, project, source},
};
use graph_flow::{
    Context, ExecutionStatus, FlowRunner, GraphBuilder, GraphError, NextAction, Session,
    SessionStorage, Task, TaskResult,
};
use rig_core::{DynModel, operation::Completion};
use sea_orm::{
    ColumnTrait, DatabaseConnection, DatabaseTransaction, EntityTrait, QueryFilter,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Arc, time::Duration};

const GRAPH: &str = "chapter-splitting-v1";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Checkpoint {
    version: u32,
    session: Session,
    last_tool: Option<ToolBoundary>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ToolBoundary {
    message_id: String,
    call_id: String,
}

fn decode(value: serde_json::Value, session: &str) -> Result<Checkpoint, AiError> {
    let checkpoint: Checkpoint =
        serde_json::from_value(value).map_err(|_| AiError::InvalidRequest)?;
    if checkpoint.version != 1
        || checkpoint.session.id != session
        || checkpoint.session.graph_id != GRAPH
        || !matches!(
            checkpoint.session.current_task_id.as_str(),
            "prepare" | "diagnose" | "validate" | "review"
        )
    {
        return Err(AiError::InvalidRequest);
    }
    Ok(checkpoint)
}
fn graph_error(_: impl std::fmt::Display) -> GraphError {
    GraphError::SessionConflict("checkpoint_rejected".into())
}

/// The candidate and this tool boundary commit together. The graph node remains
/// diagnose until its model loop exits; no completed business tool is replayed by
/// checkpoint recovery. The next model turn sees the shared call/result history.
pub(super) async fn tool_committed(
    tx: &DatabaseTransaction,
    lease: &Lease,
    message_id: &str,
    call_id: &str,
) -> Result<(), AiError> {
    let run = ai::runs::lock(tx, lease, false).await?;
    // Direct domain use cases can run without a graph (e.g. protocol tests).
    let Some(value) = run.checkpoint else {
        return Ok(());
    };
    let mut checkpoint = decode(value, lease.session_id())?;
    if checkpoint.session.current_task_id != "diagnose" {
        return Err(AiError::Conflict);
    }
    checkpoint.last_tool = Some(ToolBoundary {
        message_id: message_id.into(),
        call_id: call_id.into(),
    });
    ai::runs::checkpoint(
        tx,
        lease,
        serde_json::to_value(checkpoint).map_err(|_| AiError::StorageFailed)?,
    )
    .await
}

struct Storage {
    db: DatabaseConnection,
    lease: Lease,
}
#[async_trait::async_trait]
impl SessionStorage for Storage {
    async fn save(&self, mut session: Session) -> graph_flow::Result<()> {
        if session.id != self.lease.session_id() || session.graph_id != GRAPH {
            return Err(graph_error("identity"));
        }
        let tx = self.db.begin().await.map_err(graph_error)?;
        let run = ai::runs::lock(&tx, &self.lease, false)
            .await
            .map_err(graph_error)?;
        let old = run
            .checkpoint
            .map(|v| decode(v, self.lease.session_id()))
            .transpose()
            .map_err(graph_error)?;
        if old.as_ref().map_or(0, |c| c.session.version) != session.version {
            return Err(graph_error("version"));
        }
        session.version = session
            .version
            .checked_add(1)
            .ok_or_else(|| graph_error("overflow"))?;
        let checkpoint = Checkpoint {
            version: 1,
            session,
            last_tool: old.and_then(|c| c.last_tool),
        };
        let value = serde_json::to_value(checkpoint).map_err(graph_error)?;
        // Validate node and graph versions before any checkpoint write.
        decode(value.clone(), self.lease.session_id()).map_err(graph_error)?;
        ai::runs::checkpoint(&tx, &self.lease, value)
            .await
            .map_err(graph_error)?;
        ai::runs::commit(tx, &self.lease).await.map_err(graph_error)
    }
    async fn get(&self, id: &str) -> graph_flow::Result<Option<Session>> {
        if id != self.lease.session_id() {
            return Err(graph_error("identity"));
        }
        let row = ai_run::Entity::find_by_id(self.lease.run_id())
            .one(&self.db)
            .await
            .map_err(graph_error)?
            .ok_or_else(|| graph_error("missing_run"))?;
        row.checkpoint
            .map(|value| decode(value, id).map(|c| c.session))
            .transpose()
            .map_err(graph_error)
    }
    async fn delete(&self, _: &str) -> graph_flow::Result<()> {
        Err(graph_error("explicit_decision_required"))
    }
}

async fn verify_scope(tools: &SplitTools) -> Result<String, AiError> {
    let tx = tools.db.begin().await?;
    let run = ai::runs::lock(&tx, &tools.lease, false).await?;
    let session = ai_session::Entity::find_by_id(tools.lease.session_id())
        .one(&tx)
        .await?
        .ok_or(AiError::NotFound)?;
    let project = project::Entity::find_by_id(session.project_id.clone())
        .one(&tx)
        .await?
        .ok_or(AiError::NotFound)?;
    let hashes: BTreeMap<_, _> = source::Entity::find()
        .filter(source::Column::ProjectId.eq(&session.project_id))
        .all(&tx)
        .await?
        .into_iter()
        .map(|s| (s.id, s.text_sha256))
        .collect();
    if !matches!(
        session.task_kind.as_str(),
        "chapter_splitting" | "project_assistant"
    ) || project.revision != run.base_revision
        || serde_json::to_value(hashes).map_err(|_| AiError::StorageFailed)? != run.source_hashes
    {
        return Err(AiError::Conflict);
    }
    tx.commit().await?;
    Ok(session.project_id)
}

struct Node {
    id: &'static str,
    tools: SplitTools,
    model: DynModel<Completion>,
    max_output_tokens: Option<u32>,
    failure: Arc<tokio::sync::Mutex<Option<RunFailure>>>,
}
#[async_trait::async_trait]
impl Task for Node {
    fn id(&self) -> &str {
        self.id
    }
    async fn run(&self, _: Context) -> graph_flow::Result<TaskResult> {
        if let Err(error) = verify_scope(&self.tools).await {
            *self.failure.lock().await = Some(if error == AiError::Conflict {
                RunFailure::StaleProject
            } else {
                RunFailure::StorageFailed
            });
            return Err(graph_error(error));
        }
        if self.id == "diagnose"
            && let Err(error) = execution::diagnose(
                self.tools.clone(),
                self.model.clone(),
                self.max_output_tokens,
            )
            .await
        {
            *self.failure.lock().await = Some(error);
            return Err(graph_error("diagnose_failed"));
        }
        Ok(TaskResult::new(
            None,
            if self.id == "review" {
                NextAction::WaitForInput
            } else {
                NextAction::Continue
            },
        ))
    }
}

pub(crate) async fn execute(
    tools: SplitTools,
    model: DynModel<Completion>,
    max_output_tokens: Option<u32>,
) -> Result<(), RunFailure> {
    let project_id = verify_scope(&tools).await.map_err(|error| {
        if error == AiError::Conflict {
            RunFailure::StaleProject
        } else {
            RunFailure::StorageFailed
        }
    })?;
    // Database digests alone cannot detect damaged files. Validate before any
    // model request, including resumes that skip the prepare node. read releases
    // its metadata transaction before file IO; each node rechecks the scope.
    let db = tools.db.clone();
    let root = tools.root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(crate::project::store::read(&db, &root, &project_id))
            .map(|_| ())
    })
    .await
    .map_err(|_| RunFailure::StorageFailed)?
    .map_err(|_| RunFailure::StorageFailed)?;
    let storage = Arc::new(Storage {
        db: tools.db.clone(),
        lease: tools.lease.clone(),
    });
    let session = match storage
        .get(tools.lease.session_id())
        .await
        .map_err(|_| RunFailure::InvalidResponse)?
    {
        None => Some(
            Session::new_from_task(tools.lease.session_id().into(), "prepare").with_graph_id(GRAPH),
        ),
        Some(mut session) if session.current_task_id == "review" => {
            // An explicit new user turn starts another diagnosis round. An
            // interrupted validate step resumes without repeating the model.
            session.current_task_id = "prepare".into();
            Some(session)
        }
        Some(_) => None,
    };
    if let Some(session) = session {
        storage
            .save(session)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
    }
    let failure = Arc::new(tokio::sync::Mutex::new(None));
    let mut builder = GraphBuilder::new(GRAPH)
        .with_task_timeout(Duration::from_secs(600))
        .with_max_execution_steps(8);
    for id in ["prepare", "diagnose", "validate", "review"] {
        builder = builder.add_task(Arc::new(Node {
            id,
            tools: tools.clone(),
            model: model.clone(),
            max_output_tokens,
            failure: failure.clone(),
        }));
    }
    let graph = builder
        .add_edge("prepare", "diagnose")
        .add_edge("diagnose", "validate")
        .add_edge("validate", "review")
        .build()
        .map_err(|_| RunFailure::InvalidResponse)?;
    let runner = FlowRunner::new(Arc::new(graph), storage);
    for _ in 0..4 {
        let result = runner.run(tools.lease.session_id()).await;
        match result {
            Ok(result) => match result.status {
                ExecutionStatus::Paused { .. } => continue,
                ExecutionStatus::WaitingForInput => return Ok(()),
                _ => return Err(RunFailure::InvalidResponse),
            },
            Err(_) => return Err(failure.lock().await.unwrap_or(RunFailure::StorageFailed)),
        }
    }
    Err(RunFailure::InvalidResponse)
}

#[cfg(test)]
mod tests;
