//! Freezes professional task inputs within the accepted tool transaction.
use super::ToolFailure;
use crate::{
    ai::{AiError, WorkspaceAction, WorkspaceContext, runs::Lease},
    database::entity::{ai_run, project},
    voice_binding::CatalogSnapshot,
};
use sea_orm::{ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter, sea_query::Expr};
use serde_json::{Value, json};

pub(super) struct ProfessionalTask<'a> {
    pub tx: &'a DatabaseTransaction,
    pub lease: &'a Lease,
    pub project_id: &'a str,
    pub run: &'a ai_run::Model,
    pub context: Option<&'a WorkspaceContext>,
}

impl ProfessionalTask<'_> {
    async fn verify_revision(&self) -> Result<(), AiError> {
        let project = project::Entity::find_by_id(self.project_id)
            .one(self.tx)
            .await?
            .ok_or(AiError::NotFound)?;
        if project.revision == self.run.base_revision {
            Ok(())
        } else {
            Err(AiError::Conflict)
        }
    }

    async fn freeze_context(&self, context: WorkspaceContext) -> Result<(), AiError> {
        ai_run::Entity::update_many()
            .col_expr(
                ai_run::Column::WorkspaceContext,
                Expr::value(serde_json::to_value(context).map_err(|_| AiError::InvalidRequest)?),
            )
            .filter(ai_run::Column::Id.eq(self.lease.run_id()))
            .exec(self.tx)
            .await?;
        Ok(())
    }

    pub(super) async fn splitting(&self, instruction: &str) -> Result<Value, ToolFailure> {
        validate_text(instruction)?;
        self.verify_revision().await?;
        let mut context = self.context.cloned().ok_or(AiError::InvalidRequest)?;
        context.action = WorkspaceAction::Split;
        self.freeze_context(context).await?;
        Ok(json!({"status": "accepted", "published": false}))
    }

    pub(super) async fn analyze(&self, chapter_id: Option<&str>) -> Result<Value, ToolFailure> {
        let context = self.context.ok_or(AiError::InvalidRequest)?;
        let target = chapter_id
            .or(context.chapter_id.as_deref())
            .ok_or(AiError::InvalidRequest)?;
        self.verify_revision().await?;
        if context.chapter_id.as_deref() == Some(target) {
            let revision =
                crate::chapter_analysis::analysis_state(self.tx, self.project_id, target)
                    .await
                    .map_err(AiError::from)?
                    .map_or(0, |state| state.revision as u32);
            if context
                .analysis_base_revision
                .is_some_and(|base| base != revision)
            {
                return Err(AiError::Conflict.into());
            }
        }
        crate::chapter_analysis::freeze_input(
            self.tx,
            self.project_id,
            target,
            self.lease.run_id(),
            serde_json::from_value(self.run.configuration.clone())
                .map_err(|_| AiError::StorageFailed)?,
            true,
            None,
        )
        .await?;
        self.freeze_context(WorkspaceContext {
            action: WorkspaceAction::Analyze,
            chapter_id: Some(target.into()),
            analysis_base_revision: None,
        })
        .await?;
        Ok(json!({"chapter_id": target, "status": "accepted", "published": false}))
    }

    pub(super) async fn cast(
        &self,
        requirements: Option<&str>,
        catalog: Option<Result<CatalogSnapshot, AiError>>,
    ) -> Result<Value, ToolFailure> {
        if let Some(text) = requirements {
            validate_text(text)?;
        }
        let catalog = catalog.ok_or(ToolFailure::NotOffered)??;
        self.verify_revision().await?;
        crate::voice_binding::suggest::freeze(
            self.tx,
            self.project_id,
            self.lease.run_id(),
            Some(catalog),
            None,
            requirements.unwrap_or(""),
        )
        .await
        .map_err(|_| AiError::InvalidRequest)?;
        self.freeze_context(WorkspaceContext {
            action: WorkspaceAction::Cast,
            chapter_id: None,
            analysis_base_revision: None,
        })
        .await?;
        Ok(json!({"status": "accepted", "published": false}))
    }
}

fn validate_text(text: &str) -> Result<(), ToolFailure> {
    if text.trim().is_empty() || text.chars().count() > 2048 {
        return Err(ToolFailure::InvalidArguments);
    }
    Ok(())
}
