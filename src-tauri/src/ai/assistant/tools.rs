//! Database-backed model tools. No tool can adopt, discard or undo a proposal.
use crate::novel_import::splitting::{
    PreparedProposal, ProposalAction, hashes, propose_for_call,
    store::{self, SplitError},
};
use crate::{
    ai::{self, dispatch::ToolDispatch, runs::Lease},
    database::entity::ai_session,
    novel_import::{HeadingRule, ImportIssue},
    project::{self, ProjectError, line_ranges, store::LocalProject},
};
use sea_orm::{DatabaseConnection, EntityTrait, TransactionTrait};
use serde::Serialize;
use serde_json::Value;
#[cfg(test)]
use serde_json::json;
use std::{path::PathBuf, sync::Arc};
use tokio_util::sync::CancellationToken;

#[derive(Debug, thiserror::Error)]
enum ToolFailure {
    #[error("invalid_arguments")]
    InvalidArguments,
    #[error("tool_not_offered")]
    NotOffered,
    #[error("{0}")]
    Domain(#[from] SplitError),
}
impl From<ProjectError> for ToolFailure {
    fn from(e: ProjectError) -> Self {
        Self::Domain(e.into())
    }
}
impl From<ai::AiError> for ToolFailure {
    fn from(e: ai::AiError) -> Self {
        Self::Domain(e.into())
    }
}
impl From<sea_orm::DbErr> for ToolFailure {
    fn from(e: sea_orm::DbErr) -> Self {
        Self::Domain(e.into())
    }
}

#[derive(Serialize)]
struct AnalysisAccepted<'a> {
    chapter_id: &'a str,
    status: Acceptance,
    published: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum Acceptance {
    Accepted,
}

#[derive(Serialize)]
struct SplittingAccepted {
    status: Acceptance,
    published: bool,
}

#[derive(Clone)]
pub(crate) struct WorkspaceTools {
    #[cfg(test)]
    pub experiment: Option<Arc<ai::efficiency::Experiment>>,
    pub db: DatabaseConnection,
    pub root: PathBuf,
    pub lease: Lease,
    pub dispatch: ToolDispatch,
    pub token: CancellationToken,
    pub workers: Arc<tokio::sync::Semaphore>,
}
mod arguments;
use arguments::*;
mod adapter;
mod read;
pub(super) use adapter::Scope;
pub(super) use adapter::safe_name;

impl WorkspaceTools {
    #[cfg(test)]
    async fn execute(&self, name: &str, args: Value) -> Result<Value, ToolFailure> {
        let command = Command::decode(name, &args).map_err(|_| ToolFailure::InvalidArguments);
        self.execute_command(name, args, command).await
    }
    async fn execute_command(
        &self,
        name: &str,
        args: Value,
        command: Result<Command, ToolFailure>,
    ) -> Result<Value, ToolFailure> {
        let call = self.dispatch.accepted(name, &args).await?;
        if self.token.is_cancelled() {
            return Err(ProjectError::Cancelled.into());
        }
        let tx = self.db.begin().await?;
        let run = ai::runs::lock(&tx, &self.lease, false).await?;
        let session = ai_session::Entity::find_by_id(self.lease.session_id())
            .one(&tx)
            .await?
            .ok_or(ai::AiError::NotFound)?;
        if !matches!(
            session.task_kind.as_str(),
            "chapter_splitting" | "project_assistant"
        ) {
            return Err(ai::AiError::Conflict.into());
        }
        let context: Option<ai::WorkspaceContext> = run
            .workspace_context
            .clone()
            .map(serde_json::from_value)
            .transpose()
            .map_err(|_| ai::AiError::StorageFailed)?;
        let scope = Scope::from_context(&session.task_kind, context.as_ref())?;
        if !scope.allows(name) {
            return Err(ToolFailure::NotOffered);
        }
        let command = command?;
        #[cfg(test)]
        if let Command::CompareRules(args) = &command
            && self
                .experiment
                .as_ref()
                .is_some_and(|e| e.profile == ai::efficiency::Profile::Atomic)
            && args.variants.len() > 1
        {
            return Err(ToolFailure::InvalidArguments);
        }

        if command.name() != name {
            return Err(ToolFailure::NotOffered);
        }
        if let Command::CheckSplitting(CheckSplitting { instruction }) = command {
            if instruction.trim().is_empty() || instruction.chars().count() > 2048 {
                return Err(ToolFailure::InvalidArguments);
            }
            // One run can own only one professional task. An accepted chapter attribution input
            // takes priority on recovery, so never acknowledge a second task.
            if crate::database::entity::analysis_input::Entity::find_by_id(self.lease.run_id())
                .one(&tx)
                .await?
                .is_some()
            {
                return Err(ai::AiError::Conflict.into());
            }
            let project = crate::database::entity::project::Entity::find_by_id(&session.project_id)
                .one(&tx)
                .await?
                .ok_or(ai::AiError::NotFound)?;
            if project.revision != run.base_revision {
                return Err(ai::AiError::Conflict.into());
            }
            let mut context = context.ok_or(ai::AiError::InvalidRequest)?;
            context.action = ai::WorkspaceAction::Split;
            use sea_orm::{ActiveModelTrait, ActiveValue::Set, IntoActiveModel};
            let mut row = run.into_active_model();
            row.workspace_context = Set(Some(
                serde_json::to_value(context).map_err(|_| ai::AiError::InvalidRequest)?,
            ));
            row.update(&tx).await?;
            let output = serde_json::to_value(SplittingAccepted {
                status: Acceptance::Accepted,
                published: false,
            })
            .map_err(|_| ai::AiError::InvalidRequest)?;
            // Intent and its accepted call publish together, including on a crash
            // between the business callback and Rig's outcome hook.
            ai::tools::complete(
                &tx,
                &self.lease,
                &call.message_id,
                &call.id,
                output.clone(),
                false,
                None,
            )
            .await?;
            ai::runs::commit(tx, &self.lease).await?;
            return Ok(output);
        }
        if let Command::ReadAnalysis(ReadAnalysis { chapter_id, page }) = command {
            let target = chapter_id
                .as_deref()
                .or_else(|| context.as_ref().and_then(|c| c.chapter_id.as_deref()))
                .ok_or(ai::AiError::InvalidRequest)?;
            return crate::chapter_analysis::inspect(&tx, &session.project_id, target, page)
                .await
                .map_err(|e| ToolFailure::from(ai::AiError::from(e)));
        }
        if let Command::AnalyzeChapter(AnalyzeChapter { chapter_id }) = command {
            let context = context.ok_or(ai::AiError::InvalidRequest)?;
            let target = chapter_id
                .as_deref()
                .or(context.chapter_id.as_deref())
                .ok_or(ai::AiError::InvalidRequest)?;
            let project = crate::database::entity::project::Entity::find_by_id(&session.project_id)
                .one(&tx)
                .await?
                .ok_or(ai::AiError::NotFound)?;
            if project.revision != run.base_revision {
                return Err(ai::AiError::Conflict.into());
            }
            if crate::database::entity::analysis_input::Entity::find_by_id(self.lease.run_id())
                .one(&tx)
                .await?
                .is_some()
            {
                return Err(ai::AiError::Conflict.into());
            }
            crate::chapter_analysis::freeze_input(
                &tx,
                &session.project_id,
                target,
                self.lease.run_id(),
                serde_json::from_value(run.configuration)
                    .map_err(|_| ai::AiError::StorageFailed)?,
                true,
                None,
            )
            .await?;
            use sea_orm::sea_query::Expr;
            use sea_orm::{ColumnTrait, QueryFilter};
            let frozen = ai::WorkspaceContext {
                action: ai::WorkspaceAction::Analyze,
                chapter_id: Some(target.into()),
            };
            crate::database::entity::ai_run::Entity::update_many()
                .col_expr(
                    crate::database::entity::ai_run::Column::WorkspaceContext,
                    Expr::value(
                        serde_json::to_value(frozen).map_err(|_| ai::AiError::InvalidRequest)?,
                    ),
                )
                .filter(crate::database::entity::ai_run::Column::Id.eq(self.lease.run_id()))
                .exec(&tx)
                .await?;
            ai::runs::commit(tx, &self.lease).await?;
            return serde_json::to_value(AnalysisAccepted {
                chapter_id: target,
                status: Acceptance::Accepted,
                published: false,
            })
            .map_err(|_| ProjectError::InvalidProject.into());
        }
        tx.commit().await?;
        let permit = self
            .workers
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| ProjectError::Cancelled)?;
        let db = self.db.clone();
        let root = self.root.clone();
        let token = self.token.clone();
        let accepted_input = call.input.clone();
        let prepared = tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            if token.is_cancelled() {
                return Err(ProjectError::Cancelled);
            }
            let record = tauri::async_runtime::block_on(project::store::read(
                &db,
                &root,
                &session.project_id,
            ))?;
            if record.document.project.revision != run.base_revision as u32
                || serde_json::to_value(hashes(&record))
                    .map_err(|_| ProjectError::InvalidProject)?
                    != run.source_hashes
            {
                return Err(ProjectError::Conflict);
            }
            match command {
                Command::FinishSplitting(FinishSplitting { plan }) => {
                    let action = match plan {
                        SplittingPlan::Rules { rules } => ProposalAction::Rules(rules),
                        SplittingPlan::Boundaries { corrections } => {
                            ProposalAction::Boundaries(corrections)
                        }
                    };
                    propose_for_call(&record, action, accepted_input, &token)
                        .map(|prepared| ToolValue::Proposal(Box::new(prepared)))
                }
                Command::CompareRules(CompareRules { variants }) => {
                    #[derive(Serialize)]
                    struct VariantSummary {
                        label: String,
                        summary: Option<crate::novel_import::splitting::ProposalSummary>,
                        error: Option<&'static str>,
                    }
                    if variants.is_empty() || variants.len() > 4 {
                        return Err(ProjectError::TooLarge);
                    }
                    let mut labels = std::collections::HashSet::new();
                    let mut summaries = Vec::new();
                    for variant in variants {
                        if variant.label.is_empty()
                            || variant.label.len() > 32
                            || !labels.insert(variant.label.clone())
                            || variant.rules.len() > 32
                        {
                            return Err(ProjectError::InvalidProject);
                        }
                        if token.is_cancelled() {
                            return Err(ProjectError::Cancelled);
                        }
                        let result = propose_for_call(
                            &record,
                            ProposalAction::Rules(variant.rules),
                            accepted_input.clone(),
                            &token,
                        );
                        let (summary, error) = match result {
                            Ok(prepared) => (Some(prepared.summary()), None),
                            Err(ProjectError::Cancelled) => return Err(ProjectError::Cancelled),
                            Err(_) => (None, Some("invalid_rules")),
                        };
                        summaries.push(VariantSummary {
                            label: variant.label,
                            summary,
                            error,
                        });
                    }
                    serde_json::to_value(summaries)
                        .map(ToolValue::Read)
                        .map_err(|_| ProjectError::InvalidProject)
                }
                command => read::inspect(&record, &token, command).map(ToolValue::Read),
            }
        })
        .await
        .map_err(|_| ProjectError::ReadFailed)??;
        if self.token.is_cancelled() {
            return Err(ProjectError::Cancelled.into());
        }
        match prepared {
            ToolValue::Read(value) => Ok(value),
            ToolValue::Proposal(proposed) => {
                store::publish(&self.db, &self.lease, &call.message_id, &call.id, *proposed)
                    .await
                    .map_err(ToolFailure::from)
            }
        }
    }
}
enum ToolValue {
    Read(Value),
    Proposal(Box<PreparedProposal>),
}
#[cfg(test)]
mod assistant_tests {
    use super::*;
    use crate::novel_import::splitting::test_support::{fixture_saved, tool_context};
    use sea_orm::sea_query::Expr;
    use sea_orm::{ColumnTrait, QueryFilter};

    #[tokio::test]
    async fn unified_analysis_tool_freezes_target_and_refuses_duplicate_foreign_or_cancelled_work()
    {
        let (root, db, _, lease) = fixture_saved().await;
        ai_session::Entity::update_many()
            .col_expr(
                ai_session::Column::TaskKind,
                Expr::value("project_assistant"),
            )
            .filter(ai_session::Column::Id.eq(lease.session_id()))
            .exec(&db)
            .await
            .unwrap();
        let context = ai::WorkspaceContext {
            action: ai::WorkspaceAction::Auto,
            chapter_id: Some("chapter".into()),
        };
        crate::database::entity::ai_run::Entity::update_many()
            .col_expr(
                crate::database::entity::ai_run::Column::WorkspaceContext,
                Expr::value(serde_json::to_value(context).unwrap()),
            )
            .filter(crate::database::entity::ai_run::Column::Id.eq(lease.run_id()))
            .exec(&db)
            .await
            .unwrap();
        let tools = tool_context(root.path(), &db, &lease);
        let output = ai::output::Output::new(db.clone(), lease.clone());
        output.start(1).await.unwrap();
        let message = output.id().await.unwrap();
        let args = json!({"chapter_id":"not-in-this-project"});
        tools
            .dispatch
            .begin(&message, "foreign", "analyze_chapter", args.clone())
            .await
            .unwrap();
        assert!(
            tools
                .execute("analyze_chapter", args.clone())
                .await
                .is_err()
        );
        tools
            .dispatch
            .complete(
                "foreign",
                "analyze_chapter",
                &args,
                json!({"error":"rejected"}),
                true,
            )
            .await
            .unwrap();
        let args = json!({});
        tools
            .dispatch
            .begin(&message, "valid", "analyze_chapter", args.clone())
            .await
            .unwrap();
        assert_eq!(
            tools
                .execute("analyze_chapter", args.clone())
                .await
                .unwrap()["status"],
            "accepted"
        );
        assert!(
            tools
                .execute("analyze_chapter", args.clone())
                .await
                .is_err()
        );
        let row = crate::database::entity::analysis_input::Entity::find_by_id(lease.run_id())
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.chapter_id, "chapter");
        let run = crate::database::entity::ai_run::Entity::find_by_id(lease.run_id())
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        let frozen: ai::WorkspaceContext =
            serde_json::from_value(run.workspace_context.unwrap()).unwrap();
        assert_eq!(frozen.action, ai::WorkspaceAction::Analyze);
        assert_eq!(frozen.chapter_id.as_deref(), Some("chapter"));
        tools.token.cancel();
        assert!(tools.execute("analyze_chapter", args).await.is_err());
    }
}

#[cfg(test)]
mod normalization_tests {
    use super::*;
    use crate::novel_import::splitting::test_support::{fixture_saved, tool_context};
    use sea_orm::sea_query::Expr;
    use sea_orm::{ColumnTrait, QueryFilter};
    async fn scope(
        db: &DatabaseConnection,
        lease: &Lease,
        task: &str,
        action: ai::WorkspaceAction,
    ) {
        ai_session::Entity::update_many()
            .col_expr(ai_session::Column::TaskKind, Expr::value(task))
            .filter(ai_session::Column::Id.eq(lease.session_id()))
            .exec(db)
            .await
            .unwrap();
        use crate::database::entity::ai_run;
        ai_run::Entity::update_many()
            .col_expr(
                ai_run::Column::WorkspaceContext,
                Expr::value(
                    serde_json::to_value(ai::WorkspaceContext {
                        action,
                        chapter_id: Some("chapter".into()),
                    })
                    .unwrap(),
                ),
            )
            .filter(ai_run::Column::Id.eq(lease.run_id()))
            .exec(db)
            .await
            .unwrap();
    }
    #[tokio::test]
    async fn project_assistant_publishes_unadopted_candidates_with_original_optional_arguments() {
        for (name, args) in [
            (
                "finish_splitting",
                json!({"plan":{"kind":"rules","rules":crate::novel_import::heading_rules()}}),
            ),
            (
                "finish_splitting",
                json!({"plan":{"kind":"boundaries","corrections":[{"sourceId":"source","line":0,"include":true}]}}),
            ),
        ] {
            let (root, db, state, lease) = fixture_saved().await;
            scope(&db, &lease, "project_assistant", ai::WorkspaceAction::Split).await;
            let tools = tool_context(root.path(), &db, &lease);
            tools
                .dispatch
                .begin("assistant", "call", name, args.clone())
                .await
                .unwrap();
            let output = tools.run_tool(name, args.clone()).await.unwrap();
            let output = output.as_json().unwrap();
            assert_ne!(output["ok"], false, "{output}");
            let id = output["proposal_id"].as_str().unwrap();
            let candidate = store::query(&db, id).await.unwrap();
            assert_eq!(candidate.status, store::ProposalStatus::Pending);
            let after = project::store::read(&db, root.path(), "project")
                .await
                .unwrap();
            assert_eq!(
                after.document.project.revision,
                state.document.project.revision
            );
            let page = ai::history_page(&db, lease.session_id(), None, 20)
                .await
                .unwrap();
            assert_eq!(page.session.budget.tool_calls, 1);
            let fact = page
                .messages
                .iter()
                .flat_map(|m| m.parts.parts())
                .find_map(|p| {
                    if let ai::messages::MessagePart::Tool { input, .. } = p {
                        Some(input)
                    } else {
                        None
                    }
                })
                .unwrap();
            assert_eq!(fact, &args);
        }
    }
    #[tokio::test]
    async fn accepted_analysis_cannot_acknowledge_a_second_splitting_task() {
        let (root, db, _, lease) = fixture_saved().await;
        scope(&db, &lease, "project_assistant", ai::WorkspaceAction::Auto).await;
        let tools = tool_context(root.path(), &db, &lease);
        let analysis = json!({"chapter_id":"chapter"});
        tools
            .dispatch
            .begin("assistant", "analysis", "analyze_chapter", analysis.clone())
            .await
            .unwrap();
        let accepted = tools
            .run_tool("analyze_chapter", analysis.clone())
            .await
            .unwrap();
        let accepted = accepted.as_json().unwrap();
        assert_eq!(accepted["status"], "accepted");
        tools
            .dispatch
            .complete(
                "analysis",
                "analyze_chapter",
                &analysis,
                accepted.clone(),
                false,
            )
            .await
            .unwrap();

        let splitting = json!({"instruction":"检查目录但不修改人工修正"});
        tools
            .dispatch
            .begin("assistant", "split", "check_splitting", splitting.clone())
            .await
            .unwrap();
        let rejected = tools
            .run_tool("check_splitting", splitting.clone())
            .await
            .unwrap();
        let rejected = rejected.as_json().unwrap();
        assert_eq!(rejected["ok"], false);
        assert_eq!(rejected["error"], "conflict");
        tools
            .dispatch
            .complete(
                "split",
                "check_splitting",
                &splitting,
                rejected.clone(),
                true,
            )
            .await
            .unwrap();
        assert!(!ai::tasks::splitting_accepted(&db, &lease).await.unwrap());
        assert!(
            crate::database::entity::analysis_input::Entity::find_by_id(lease.run_id())
                .one(&db)
                .await
                .unwrap()
                .is_some()
        );
        let history = ai::history_page(&db, lease.session_id(), None, 20)
            .await
            .unwrap();
        assert_eq!(history.session.budget.tool_calls, 2);
        assert!(history.messages.iter().flat_map(|message| message.parts.parts()).any(|part|
            matches!(part, ai::messages::MessagePart::Tool { name, state: ai::messages::ToolState::Failed, .. } if name == "check_splitting")));
    }

    #[tokio::test]
    async fn split_scope_rejects_analysis_even_with_a_valid_direct_typed_call() {
        for (task, action) in [
            ("chapter_splitting", ai::WorkspaceAction::Auto),
            ("project_assistant", ai::WorkspaceAction::Split),
        ] {
            let (root, db, _, lease) = fixture_saved().await;
            scope(&db, &lease, task, action).await;
            let tools = tool_context(root.path(), &db, &lease);
            let args = json!({"chapter_id":"chapter"});
            tools
                .dispatch
                .begin("assistant", "call", "analyze_chapter", args.clone())
                .await
                .unwrap();
            let output = tools.run_tool("analyze_chapter", args).await.unwrap();
            assert_eq!(output.as_json().unwrap()["error"], "tool_not_offered");
            assert!(
                crate::database::entity::analysis_input::Entity::find_by_id(lease.run_id())
                    .one(&db)
                    .await
                    .unwrap()
                    .is_none()
            );
        }
    }
}
