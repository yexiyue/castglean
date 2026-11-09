//! Host-owned professional tasks. Agents choose tools; the host owns phase transitions.
use super::{RunFailure, assistant::tools::WorkspaceTools, dispatch::ToolDispatch, runs::Lease};
use crate::{
    database::entity::{ai_session, analysis_input},
    novel_import::splitting::graph,
};
use rig_core::{DynModel, operation::Completion};
use sea_orm::{DatabaseConnection, EntityTrait};
use std::{path::Path, sync::Arc, time::Duration};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

/// Durable, self-contained user intent passed from the conversational agent.
#[derive(serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct SplittingRequest {
    #[schemars(length(min = 1, max = 2048))]
    pub instruction: String,
}

pub(crate) async fn splitting_accepted(
    db: &DatabaseConnection,
    lease: &Lease,
) -> Result<bool, RunFailure> {
    let run = crate::database::entity::ai_run::Entity::find_by_id(lease.run_id())
        .one(db)
        .await
        .map_err(|_| RunFailure::StorageFailed)?
        .ok_or(RunFailure::StorageFailed)?;
    let context: Option<super::WorkspaceContext> = run
        .workspace_context
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_| RunFailure::StorageFailed)?;
    Ok(context.is_some_and(|context| context.action == super::WorkspaceAction::Split))
}

pub(crate) struct Model {
    pub client: DynModel<Completion>,
    pub generation: crate::chapter_analysis::Generation,
}

pub(crate) struct Execution<'a> {
    pub db: &'a DatabaseConnection,
    pub root: &'a Path,
    pub lease: &'a Lease,
    pub token: &'a CancellationToken,
    pub workers: Arc<Semaphore>,
}
impl Execution<'_> {
    async fn analysis_accepted(&self) -> Result<bool, RunFailure> {
        analysis_input::Entity::find_by_id(self.lease.run_id())
            .one(self.db)
            .await
            .map(|input| input.is_some())
            .map_err(|_| RunFailure::StorageFailed)
    }

    async fn attribution(&self, model: Model) -> Result<(), RunFailure> {
        crate::chapter_analysis::execute(
            self.db,
            self.root,
            self.lease,
            model.client,
            model.generation.model.context_window,
            model.generation.model.max_output_tokens,
            Some(model.generation),
            self.token,
        )
        .await
    }

    pub(crate) async fn execute(self, model: Model) -> Result<(), RunFailure> {
        let session = ai_session::Entity::find_by_id(self.lease.session_id())
            .one(self.db)
            .await
            .map_err(|_| RunFailure::StorageFailed)?
            .ok_or(RunFailure::StorageFailed)?;
        if !matches!(
            session.task_kind.as_str(),
            "chapter_splitting" | "chapter_analysis" | "project_assistant"
        ) {
            return Err(RunFailure::ToolFailed);
        }
        // Frozen input is authoritative on retries and explicit shortcut requests.
        // No routing-model call and no implicit replay of a completed assistant turn.
        if session.task_kind == "chapter_analysis" || self.analysis_accepted().await? {
            return self.attribution(model).await;
        }
        let was_splitting = splitting_accepted(self.db, self.lease).await?;
        let tools = WorkspaceTools {
            db: self.db.clone(),
            root: self.root.into(),
            lease: self.lease.clone(),
            dispatch: ToolDispatch::new(self.db.clone(), self.lease.clone()),
            token: self.token.clone(),
            workers: self.workers.clone(),
        };
        tokio::select! {
            biased;
            () = self.token.cancelled() => return Err(RunFailure::Cancelled),
            result = tokio::time::timeout(
                Duration::from_secs(600),
                graph::execute(tools.clone(), model.client.clone(), model.generation.model.max_output_tokens),
            ) => result.unwrap_or(Err(RunFailure::Timeout))?,
        }
        if session.task_kind == "project_assistant" && self.analysis_accepted().await? {
            self.attribution(model).await
        } else if !was_splitting && splitting_accepted(self.db, self.lease).await? {
            tokio::select! {
                biased;
                () = self.token.cancelled() => Err(RunFailure::Cancelled),
                result = tokio::time::timeout(
                    Duration::from_secs(600),
                    graph::execute(tools, model.client, model.generation.model.max_output_tokens),
                ) => result.unwrap_or(Err(RunFailure::Timeout)),
            }
        } else {
            Ok(())
        }
    }
}
