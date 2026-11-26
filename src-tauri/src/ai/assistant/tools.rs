//! Database-backed model tools. No tool can adopt, discard or undo a proposal.
use crate::novel_import::splitting::{
    PreparedProposal, ProposalAction, compare_rules, hashes, propose_for_call,
};
use crate::{
    ai::{
        self,
        dispatch::{Call, ToolDispatch},
        runs::Lease,
        split_execution::publication::{self, SplitError},
    },
    database::entity::{ai_run, ai_session, analysis_input, casting_input},
    project::detection::{HeadingRule, ImportIssue},
    project::{self, ProjectError, line_ranges, store::LocalProject},
};
use sea_orm::{DatabaseConnection, EntityTrait, TransactionTrait};
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

#[derive(Clone)]
pub(crate) struct WorkspaceTools {
    #[cfg(test)]
    pub experiment: Option<Arc<ai::efficiency::Experiment>>,
    pub catalog: Option<crate::voice_binding::CatalogProvider>,
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
mod professional;
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
        // Catalog I/O must not hold SQLite's writer. Defer its error until the
        // authoritative scope and task guards below have selected the outcome.
        let casting_catalog = match (&command, self.catalog.clone()) {
            (Ok(Command::CastVoices(_)), Some(provider)) => Some(
                tauri::async_runtime::spawn_blocking(move || provider())
                    .await
                    .map_err(|_| ai::AiError::StorageFailed)
                    .and_then(|catalog| catalog.map_err(|_| ai::AiError::StorageFailed)),
            ),
            _ => None,
        };
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
        let command = command?;
        if matches!(
            &command,
            Command::CheckSplitting(_) | Command::AnalyzeChapter(_) | Command::CastVoices(_)
        ) && (context
            .as_ref()
            .is_some_and(|context| context.action == ai::WorkspaceAction::Split)
            || analysis_input::Entity::find_by_id(self.lease.run_id())
                .one(&tx)
                .await?
                .is_some()
            || casting_input::Entity::find_by_id(self.lease.run_id())
                .one(&tx)
                .await?
                .is_some())
        {
            return Err(ai::AiError::Conflict.into());
        }
        if !scope.allows(name) {
            return Err(ToolFailure::NotOffered);
        }
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
        let task = professional::ProfessionalTask {
            tx: &tx,
            lease: &self.lease,
            project_id: &session.project_id,
            run: &run,
            context: context.as_ref(),
        };
        let output = match command {
            Command::RequestInput(RequestInput { message }) => {
                let interrupt =
                    ai::interrupts::request(&tx, &self.lease, &call.id, &message).await?;
                serde_json::json!({"status": "waiting", "interruptId": interrupt["id"]})
            }
            Command::CheckSplitting(CheckSplitting { instruction }) => {
                task.splitting(&instruction).await?
            }
            Command::AnalyzeChapter(AnalyzeChapter { chapter_id }) => {
                task.analyze(chapter_id.as_deref()).await?
            }
            Command::CastVoices(CastVoices { requirements }) => {
                task.cast(requirements.as_deref(), casting_catalog).await?
            }
            Command::ReadAnalysis(ReadAnalysis { chapter_id, page }) => {
                let target = chapter_id
                    .as_deref()
                    .or_else(|| {
                        context
                            .as_ref()
                            .and_then(|context| context.chapter_id.as_deref())
                    })
                    .ok_or(ai::AiError::InvalidRequest)?;
                return crate::chapter_analysis::inspect(&tx, &session.project_id, target, page)
                    .await
                    .map_err(|error| ToolFailure::from(ai::AiError::from(error)));
            }
            command => {
                tx.commit().await?;
                return self
                    .read_project_tool(call, command, session.project_id, run)
                    .await;
            }
        };
        // The approved intent and its tool receipt survive a crash together.
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
        Ok(output)
    }

    async fn read_project_tool(
        &self,
        call: Call,
        command: Command,
        project_id: String,
        run: ai_run::Model,
    ) -> Result<Value, ToolFailure> {
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
            let record =
                tauri::async_runtime::block_on(project::store::read(&db, &root, &project_id))?;
            if record.document.project.revision != run.base_revision as u32
                || serde_json::to_value(hashes(&record))
                    .map_err(|_| ProjectError::InvalidProject)?
                    != run.source_hashes
            {
                return Err(ProjectError::Conflict);
            }
            match command {
                Command::RequestInput(_) => Err(ProjectError::InvalidProject),
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
                    serde_json::to_value(compare_rules(&record, variants, &token)?)
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
                publication::publish(&self.db, &self.lease, &call.message_id, &call.id, *proposed)
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
        let mut context = ai::WorkspaceContext {
            action: ai::WorkspaceAction::Auto,
            chapter_id: Some("chapter".into()),
            analysis_base_revision: Some(1),
        };
        crate::database::entity::ai_run::Entity::update_many()
            .col_expr(
                crate::database::entity::ai_run::Column::WorkspaceContext,
                Expr::value(serde_json::to_value(&context).unwrap()),
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
        let stale_args = json!({});
        tools
            .dispatch
            .begin(&message, "stale", "analyze_chapter", stale_args.clone())
            .await
            .unwrap();
        assert!(
            tools
                .execute("analyze_chapter", stale_args.clone())
                .await
                .is_err()
        );
        assert!(
            crate::database::entity::analysis_input::Entity::find_by_id(lease.run_id())
                .one(&db)
                .await
                .unwrap()
                .is_none()
        );
        tools
            .dispatch
            .complete(
                "stale",
                "analyze_chapter",
                &stale_args,
                json!({"error":"rejected"}),
                true,
            )
            .await
            .unwrap();
        context.analysis_base_revision = Some(0);
        crate::database::entity::ai_run::Entity::update_many()
            .col_expr(
                crate::database::entity::ai_run::Column::WorkspaceContext,
                Expr::value(serde_json::to_value(context).unwrap()),
            )
            .filter(crate::database::entity::ai_run::Column::Id.eq(lease.run_id()))
            .exec(&db)
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

    #[tokio::test]
    async fn cast_voices_acceptance_freezes_catalog_requirements_and_guards_one_task() {
        use crate::voice_binding::CatalogSnapshot;
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
            analysis_base_revision: None,
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
        let mut tools = tool_context(root.path(), &db, &lease);
        tools.catalog = Some(std::sync::Arc::new(|| {
            Ok(CatalogSnapshot {
                library: vec![],
                presets: vec![],
            })
        }));
        let output = ai::output::Output::new(db.clone(), lease.clone());
        output.start(1).await.unwrap();
        let message = output.id().await.unwrap();
        let args = json!({"requirements":"只配主角，配角先不管"});
        tools
            .dispatch
            .begin(&message, "call", "cast_voices", args.clone())
            .await
            .unwrap();
        assert_eq!(
            tools.execute("cast_voices", args.clone()).await.unwrap()["status"],
            "accepted"
        );
        let row = crate::database::entity::casting_input::Entity::find_by_id(lease.run_id())
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        let frozen: crate::voice_binding::StoredCastingInput =
            serde_json::from_value(row.content).unwrap();
        assert_eq!(frozen.instructions, "只配主角，配角先不管");
        let run = crate::database::entity::ai_run::Entity::find_by_id(lease.run_id())
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        let frozen_context: ai::WorkspaceContext =
            serde_json::from_value(run.workspace_context.unwrap()).unwrap();
        assert_eq!(frozen_context.action, ai::WorkspaceAction::Cast);
        assert!(frozen_context.chapter_id.is_none());
        // 同一运行不接受第二个专业任务；空要求走默认意图。
        assert!(tools.execute("cast_voices", args).await.is_err());
        let tools_without_catalog = tool_context(root.path(), &db, &lease);
        let args = json!({});
        tools_without_catalog
            .dispatch
            .begin(&message, "bare", "cast_voices", args.clone())
            .await
            .unwrap();
        assert_eq!(
            tools_without_catalog
                .execute("cast_voices", args)
                .await
                .unwrap_err()
                .to_string(),
            "conflict"
        );
    }
}

#[cfg(test)]
mod normalization_tests {
    use super::*;
    use crate::novel_import::splitting::store;
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
                        analysis_base_revision: None,
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
                json!({"plan":{"kind":"rules","rules":crate::project::detection::builtin()}}),
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
    async fn casting_catalog_preload_runs_off_thread_without_holding_sqlite_writer() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let (root, db, _, lease) = fixture_saved().await;
        scope(&db, &lease, "project_assistant", ai::WorkspaceAction::Auto).await;
        let mut tools = tool_context(root.path(), &db, &lease);
        let worker_db = db.clone();
        let async_thread = std::thread::current().id();
        let off_thread = Arc::new(AtomicBool::new(false));
        let observed = off_thread.clone();
        tools.catalog = Some(Arc::new(move || {
            observed.store(
                std::thread::current().id() != async_thread,
                Ordering::SeqCst,
            );
            // A separate write would time out if acceptance already held the writer.
            let write = tauri::async_runtime::block_on(tokio::time::timeout(
                std::time::Duration::from_secs(1),
                crate::database::entity::project::Entity::update_many()
                    .col_expr(
                        crate::database::entity::project::Column::UpdatedAt,
                        Expr::col(crate::database::entity::project::Column::UpdatedAt),
                    )
                    .exec(&worker_db),
            ));
            match write {
                Ok(Ok(_)) => Ok(crate::voice_binding::CatalogSnapshot {
                    library: vec![],
                    presets: vec![],
                }),
                _ => Err(crate::voice_binding::BindingError::ReadFailed),
            }
        }));
        let output = ai::output::Output::new(db.clone(), lease.clone());
        output.start(1).await.unwrap();
        tools
            .dispatch
            .begin(
                &output.id().await.unwrap(),
                "cast",
                "cast_voices",
                json!({}),
            )
            .await
            .unwrap();
        let accepted = tools.run_tool("cast_voices", json!({})).await.unwrap();
        assert_eq!(accepted.as_json().unwrap()["status"], "accepted");
        assert!(off_thread.load(Ordering::SeqCst));
        let page = ai::history_page(&db, lease.session_id(), None, 20)
            .await
            .unwrap();
        assert_eq!(page.session.budget.tool_calls, 1);
    }

    #[tokio::test]
    async fn casting_preload_failure_does_not_mask_scope_or_task_rejection() {
        for (task, action, expected) in [
            (
                "chapter_splitting",
                ai::WorkspaceAction::Auto,
                "tool_not_offered",
            ),
            ("project_assistant", ai::WorkspaceAction::Split, "conflict"),
        ] {
            let (root, db, _, lease) = fixture_saved().await;
            scope(&db, &lease, task, action).await;
            let mut tools = tool_context(root.path(), &db, &lease);
            tools.catalog = Some(Arc::new(|| {
                Err(crate::voice_binding::BindingError::ReadFailed)
            }));
            let output = ai::output::Output::new(db.clone(), lease.clone());
            output.start(1).await.unwrap();
            tools
                .dispatch
                .begin(
                    &output.id().await.unwrap(),
                    "cast",
                    "cast_voices",
                    json!({}),
                )
                .await
                .unwrap();
            let rejected = tools.run_tool("cast_voices", json!({})).await.unwrap();
            assert_eq!(rejected.as_json().unwrap()["error"], expected);
            assert!(
                crate::database::entity::casting_input::Entity::find_by_id(lease.run_id())
                    .one(&db)
                    .await
                    .unwrap()
                    .is_none()
            );
            let page = ai::history_page(&db, lease.session_id(), None, 20)
                .await
                .unwrap();
            assert_eq!(page.session.budget.tool_calls, 1);
        }
    }

    #[tokio::test]
    async fn split_scope_rejects_analysis_even_with_a_valid_direct_typed_call() {
        for (task, action, expected_error) in [
            (
                "chapter_splitting",
                ai::WorkspaceAction::Auto,
                "tool_not_offered",
            ),
            ("project_assistant", ai::WorkspaceAction::Split, "conflict"),
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
            assert_eq!(output.as_json().unwrap()["error"], expected_error);
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
