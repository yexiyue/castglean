//! One assistant message per run; completion turns append ordered text and tool parts.
use super::{
    AiError,
    budget::Charge,
    messages::{MessagePart, MessageParts},
    runs::{self, Lease, MessageState},
};
use crate::database::entity::ai_message;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, TransactionTrait};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
pub(crate) struct Output {
    db: DatabaseConnection,
    lease: Lease,
    current: Arc<Mutex<Option<String>>>,
}
impl Output {
    pub(crate) fn new(db: DatabaseConnection, lease: Lease) -> Self {
        Self {
            db,
            lease,
            current: Arc::new(Mutex::new(None)),
        }
    }
    /// A second domain phase of the same run appends to its stable assistant
    /// message. Stream consumers must not see a new response identity mid-run.
    pub(crate) async fn resume(db: DatabaseConnection, lease: Lease) -> Result<Self, AiError> {
        let existing = ai_message::Entity::find()
            .filter(ai_message::Column::RunId.eq(lease.run_id()))
            .filter(ai_message::Column::SessionId.eq(lease.session_id()))
            .filter(ai_message::Column::Role.eq("assistant"))
            .one(&db)
            .await?;
        Ok(Self {
            db,
            lease,
            current: Arc::new(Mutex::new(existing.map(|m| m.id))),
        })
    }
    pub(crate) async fn id(&self) -> Result<String, AiError> {
        self.current.lock().await.clone().ok_or(AiError::Conflict)
    }
    pub(crate) async fn start(&self, input_bytes: u32) -> Result<(), AiError> {
        let mut current = self.current.lock().await;
        let tx = self.db.begin().await?;
        runs::lock(&tx, &self.lease, false).await?;
        runs::charge(&tx, &self.lease, Charge::Request { input_bytes }).await?;
        if let Some(id) = current.as_deref() {
            use sea_orm::{ActiveModelTrait, ActiveValue::Set, IntoActiveModel};
            let row = ai_message::Entity::find_by_id(id)
                .one(&tx)
                .await?
                .ok_or(AiError::StorageFailed)?;
            let version = row.version as u32;
            let parts = row.parts.clone();
            let mut update = row.into_active_model();
            update.usage = Set(None);
            update.update(&tx).await?;
            runs::message(
                &tx,
                &self.lease,
                id,
                Some(version),
                parts,
                MessageState::Streaming,
            )
            .await?;
            return runs::commit(tx, &self.lease).await;
        }
        let id = uuid::Uuid::new_v4().to_string();
        runs::message(
            &tx,
            &self.lease,
            &id,
            None,
            MessageParts::new(vec![]).map_err(|_| AiError::StorageFailed)?,
            MessageState::Streaming,
        )
        .await?;
        runs::commit(tx, &self.lease).await?;
        *current = Some(id);
        Ok(())
    }
    pub(crate) async fn text(&self, text: &str) -> Result<(), AiError> {
        if text.is_empty() {
            return Ok(());
        }
        let current = self.current.lock().await;
        let id = current.as_deref().ok_or(AiError::Conflict)?;
        let tx = self.db.begin().await?;
        runs::lock(&tx, &self.lease, false).await?;
        let row = ai_message::Entity::find_by_id(id)
            .one(&tx)
            .await?
            .ok_or(AiError::StorageFailed)?;
        let mut parts = row.parts.parts().to_vec();
        let total: usize = parts
            .iter()
            .filter_map(|p| match p {
                MessagePart::Text { text } => Some(text.len()),
                _ => None,
            })
            .sum();
        if total.saturating_add(text.len()) > 16 * 1024 * 1024 {
            return Err(AiError::BudgetExhausted);
        }
        if let Some(MessagePart::Text { text: saved }) = parts.last_mut() {
            saved.push_str(text);
        } else {
            parts.push(MessagePart::Text { text: text.into() });
        }
        runs::message(
            &tx,
            &self.lease,
            id,
            Some(row.version as u32),
            MessageParts::new(parts).map_err(|_| AiError::InvalidRequest)?,
            MessageState::Streaming,
        )
        .await?;
        runs::commit(tx, &self.lease).await
    }
    pub(crate) async fn usage(&self, usage: &rig_core::completion::Usage) -> Result<(), AiError> {
        use sea_orm::{ActiveModelTrait, ActiveValue::Set, IntoActiveModel};
        let current = self.current.lock().await;
        let id = current.as_deref().ok_or(AiError::Conflict)?;
        let tx = self.db.begin().await?;
        runs::lock(&tx, &self.lease, false).await?;
        let row = ai_message::Entity::find_by_id(id)
            .one(&tx)
            .await?
            .ok_or(AiError::StorageFailed)?;
        let version = row.version as u32;
        let parts = row.parts.clone();
        let mut update = row.into_active_model();
        let value = super::types::TokenUsage {
            input_tokens: usage.input_tokens.and_then(|n| n.try_into().ok()),
            output_tokens: usage.output_tokens.and_then(|n| n.try_into().ok()),
            cached_input_tokens: usage.cached_input_tokens.and_then(|n| n.try_into().ok()),
        };
        update.usage = Set(
            if value.input_tokens.is_some() || value.output_tokens.is_some() {
                Some(super::types::encode(&value)?)
            } else {
                None
            },
        );
        update.update(&tx).await?;
        runs::message(
            &tx,
            &self.lease,
            id,
            Some(version),
            parts,
            MessageState::Streaming,
        )
        .await?;
        runs::commit(tx, &self.lease).await
    }

    pub(crate) async fn complete(&self) -> Result<(), AiError> {
        let mut current = self.current.lock().await;
        let Some(id) = current.as_deref() else {
            return Ok(());
        };
        let tx = self.db.begin().await?;
        runs::lock(&tx, &self.lease, false).await?;
        let row = ai_message::Entity::find_by_id(id)
            .one(&tx)
            .await?
            .ok_or(AiError::StorageFailed)?;
        runs::message(
            &tx,
            &self.lease,
            id,
            Some(row.version as u32),
            row.parts,
            MessageState::Complete,
        )
        .await?;
        runs::commit(tx, &self.lease).await?;
        *current = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
