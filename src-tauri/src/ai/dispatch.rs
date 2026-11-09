//! Identity bridge for Rig's serial tool dispatch. Call IDs come from hooks,
//! never from model arguments; tool callbacks receive only the accepted call.
use super::{
    AiError,
    runs::{self, Lease},
    tools,
};
use sea_orm::{DatabaseConnection, TransactionTrait};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
pub(crate) struct ToolDispatch {
    db: DatabaseConnection,
    lease: Lease,
    agent_id: String,
    active: Arc<Mutex<Option<Call>>>,
}

#[derive(Clone)]
pub(crate) struct Call {
    pub message_id: String,
    pub id: String,
    pub name: String,
    pub input: Value,
}

impl ToolDispatch {
    fn identity(&self, provider_id: &str) -> Result<String, AiError> {
        if provider_id.is_empty() || provider_id.len() > 256 {
            return Err(AiError::InvalidRequest);
        }
        Ok(crate::project::hash(
            &serde_json::to_vec(&(self.lease.run_id(), &self.agent_id, provider_id))
                .map_err(|_| AiError::InvalidRequest)?,
        ))
    }
    pub(crate) fn new(db: DatabaseConnection, lease: Lease) -> Self {
        Self {
            db,
            lease,
            agent_id: uuid::Uuid::new_v4().to_string(),
            active: Arc::new(Mutex::new(None)),
        }
    }

    /// Independent agents may reuse provider call IDs in the same application run.
    /// Clones within one agent share identity; a new execution never aliases it.
    pub(crate) fn for_agent(&self) -> Self {
        Self::new(self.db.clone(), self.lease.clone())
    }

    /// Called before Rig executes a tool. A duplicate is refused rather than
    /// silently repeating a side effect. The runner must use tool_concurrency(1).
    pub(crate) async fn begin(
        &self,
        message_id: &str,
        provider_id: &str,
        name: &str,
        input: Value,
    ) -> Result<(), AiError> {
        let id = self.identity(provider_id)?;
        let mut active = self.active.lock().await;
        if active.is_some() {
            return Err(AiError::Busy);
        }
        let tx = self.db.begin().await?;
        if !tools::begin(&tx, &self.lease, message_id, &id, name, input.clone()).await? {
            return Err(AiError::Conflict);
        }
        runs::commit(tx, &self.lease).await?;
        *active = Some(Call {
            message_id: message_id.into(),
            id,
            name: name.into(),
            input,
        });
        Ok(())
    }

    pub(crate) async fn accepted(&self, name: &str, input: &Value) -> Result<Call, AiError> {
        self.active
            .lock()
            .await
            .as_ref()
            .filter(|call| call.name == name && call.input == *input)
            .cloned()
            .ok_or(AiError::Conflict)
    }

    /// Called on the SDK outcome, including tool failures. Candidate tools have
    /// already atomically completed their fact; this preserves their reference.
    pub(crate) async fn complete(
        &self,
        provider_id: &str,
        name: &str,
        input: &Value,
        output: Value,
        failed: bool,
    ) -> Result<(), AiError> {
        let id = self.identity(provider_id)?;
        let mut active = self.active.lock().await;
        let call = active
            .as_ref()
            .filter(|c| c.id == id && c.name == name && c.input == *input)
            .ok_or(AiError::Conflict)?;
        let tx = self.db.begin().await?;
        if tools::complete(
            &tx,
            &self.lease,
            &call.message_id,
            &call.id,
            output,
            failed,
            None,
        )
        .await?
        {
            runs::commit(tx, &self.lease).await?;
        } else {
            tx.commit().await?;
        }
        *active = None;
        Ok(())
    }
}
