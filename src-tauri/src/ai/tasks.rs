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

/// Lazily reads the current voice catalog (library + compiled-model presets)
/// for casting acceptance from the assistant toolset.
pub(crate) type CatalogProvider = std::sync::Arc<
    dyn Fn() -> Result<crate::voice_binding::CatalogSnapshot, crate::voice_binding::BindingError>
        + Send
        + Sync,
>;

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
    #[cfg(test)]
    pub experiment: Option<Arc<super::efficiency::Experiment>>,
    pub db: &'a DatabaseConnection,
    pub root: &'a Path,
    pub lease: &'a Lease,
    pub token: &'a CancellationToken,
    pub workers: Arc<Semaphore>,
    /// Casting acceptance reads a fresh catalog lazily; absent in tests.
    pub catalog: Option<CatalogProvider>,
}
impl Execution<'_> {
    async fn analysis_accepted(&self) -> Result<bool, RunFailure> {
        analysis_input::Entity::find_by_id(self.lease.run_id())
            .one(self.db)
            .await
            .map(|input| input.is_some())
            .map_err(|_| RunFailure::StorageFailed)
    }

    async fn casting_accepted(&self) -> Result<bool, RunFailure> {
        crate::database::entity::casting_input::Entity::find_by_id(self.lease.run_id())
            .one(self.db)
            .await
            .map(|input| input.is_some())
            .map_err(|_| RunFailure::StorageFailed)
    }

    async fn attribution(&self, model: Model) -> Result<(), RunFailure> {
        let lease = super::invocations::begin(self.db, self.lease, "chapter_analysis")
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        let outcome = crate::chapter_analysis::execute(
            self.db,
            self.root,
            &lease,
            model.client,
            model.generation.model.context_window,
            model.generation.model.max_output_tokens,
            Some(model.generation),
            self.token,
        )
        .await;
        super::invocations::finish(self.db, &lease, &outcome)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        outcome
    }

    async fn casting(&self, model: Model) -> Result<(), RunFailure> {
        let lease = super::invocations::begin(self.db, self.lease, "casting")
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        let outcome = crate::voice_binding::suggest::execute(
            self.db,
            self.root,
            &lease,
            model.client,
            model.generation.model.max_output_tokens,
            self.token,
        )
        .await;
        super::invocations::finish(self.db, &lease, &outcome)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        outcome
    }

    async fn graph(&self, model: &Model, professional: bool) -> Result<(), RunFailure> {
        let invocation = if professional {
            Some(
                super::invocations::begin(self.db, self.lease, "chapter_splitting")
                    .await
                    .map_err(|_| RunFailure::StorageFailed)?,
            )
        } else {
            None
        };
        let lease = invocation.as_ref().unwrap_or(self.lease);
        let tools = WorkspaceTools {
            #[cfg(test)]
            experiment: self.experiment.clone(),
            catalog: self.catalog.clone(),
            db: self.db.clone(),
            root: self.root.into(),
            lease: lease.clone(),
            dispatch: ToolDispatch::new(self.db.clone(), lease.clone()),
            token: self.token.clone(),
            workers: self.workers.clone(),
        };
        let outcome = tokio::select! {
            biased;
            () = self.token.cancelled() => Err(RunFailure::Cancelled),
            result = tokio::time::timeout(Duration::from_secs(600), graph::execute(
                tools, model.client.clone(), model.generation.model.max_output_tokens)) =>
                result.unwrap_or(Err(RunFailure::Timeout)),
        };
        if let Some(lease) = invocation {
            super::invocations::finish(self.db, &lease, &outcome)
                .await
                .map_err(|_| RunFailure::StorageFailed)?;
        }
        outcome
    }

    pub(crate) async fn execute(self, model: Model) -> Result<(), RunFailure> {
        let session = ai_session::Entity::find_by_id(self.lease.session_id())
            .one(self.db)
            .await
            .map_err(|_| RunFailure::StorageFailed)?
            .ok_or(RunFailure::StorageFailed)?;
        if session.protocol_version != 1
            || !matches!(
                session.task_kind.as_str(),
                "chapter_splitting" | "chapter_analysis" | "project_assistant"
            )
        {
            return Err(RunFailure::ToolFailed);
        }
        if session.task_kind == "chapter_analysis" || self.analysis_accepted().await? {
            return self.attribution(model).await;
        }
        if self.casting_accepted().await? {
            return self.casting(model).await;
        }
        let was_splitting = splitting_accepted(self.db, self.lease).await?;
        self.graph(
            &model,
            was_splitting || session.task_kind == "chapter_splitting",
        )
        .await?;
        if session.task_kind == "project_assistant" && self.analysis_accepted().await? {
            self.attribution(model).await
        } else if self.casting_accepted().await? {
            self.casting(model).await
        } else if !was_splitting && splitting_accepted(self.db, self.lease).await? {
            self.graph(&model, true).await
        } else {
            Ok(())
        }
    }
}
