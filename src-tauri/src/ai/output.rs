//! One assistant message per run; completion turns append ordered text and tool parts.
use super::{
    AiError,
    budget::Charge,
    messages::{MessagePart, MessageParts},
    runs::{self, Lease, MessageState},
};
use crate::database::entity::ai_message;
use sea_orm::{DatabaseConnection, EntityTrait, TransactionTrait};
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
    pub(crate) async fn id(&self) -> Result<String, AiError> {
        self.current.lock().await.clone().ok_or(AiError::Conflict)
    }
    pub(crate) async fn start(&self, input_bytes: u32) -> Result<(), AiError> {
        let mut current = self.current.lock().await;
        let tx = self.db.begin().await?;
        runs::lock(&tx, &self.lease, false).await?;
        runs::charge(&tx, &self.lease, Charge::Request { input_bytes }).await?;
        if current.is_some() {
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
        if total.saturating_add(text.len()) > 256 * 1024 {
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
