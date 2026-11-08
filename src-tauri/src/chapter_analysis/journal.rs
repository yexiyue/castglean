//! Versioned step results and safe request observations, fenced by the parent run lease.
use crate::{
    ai::{
        RunFailure,
        output::Output,
        runs::{self, Lease},
    },
    database::entity::{ai_run, analysis_window},
};
use rig_core::{
    DynModel,
    completion::{CompletionRequest, Usage},
    operation::Completion,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait,
    IntoActiveModel, QueryFilter, QueryOrder, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    sync::Arc,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

const FORMAT: u32 = 5;

#[derive(Clone)]
pub(crate) struct RequestLimits {
    pub global: Arc<Semaphore>,
    pub connection: Arc<Semaphore>,
    pub model: String,
    pub discover_roles: bool,
}
impl RequestLimits {
    pub(crate) fn new(global: Arc<Semaphore>, model: String) -> Self {
        Self {
            global,
            connection: Arc::new(Semaphore::new(2)),
            model,
            discover_roles: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Span {
    pub run_id: String,
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub stage: String,
    pub route: String,
    pub attempt: u32,
    pub status: String,
    pub started_at: u64,
    pub elapsed_ms: u64,
    pub model: String,
    pub configuration_hash: String,
    pub prompt_version: String,
    pub prompt_hash: String,
    pub protocol_version: String,
    pub source_hash: String,
    pub usage: Counters,
    pub error: Option<RunFailure>,
    #[serde(rename = "isRequest")]
    pub request: bool,
}
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Counters {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cached_input_tokens: Option<u64>,
    reasoning_tokens: Option<u64>,
}
impl From<&Usage> for Counters {
    fn from(u: &Usage) -> Self {
        Self {
            input_tokens: u.input_tokens,
            output_tokens: u.output_tokens,
            cached_input_tokens: u.cached_input_tokens,
            reasoning_tokens: u.reasoning_tokens,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entry {
    format_version: u32,
    fingerprint: String,
    stage: String,
    result: Option<Value>,
    spans: Vec<Span>,
}

#[derive(Clone)]
pub(super) struct Journal {
    pub db: DatabaseConnection,
    pub lease: Lease,
    pub origin: String,
    pub output: Output,
    pub limits: RequestLimits,
    pub token: CancellationToken,
    pub configuration_hash: String,
    pub source_hash: String,
    pub explicit_resume: bool,
}

pub(super) struct Call<'a> {
    pub ordinal: i32,
    pub stage: &'a str,
    pub fingerprint: &'a str,
    pub prompt: &'a str,
    pub version: &'a str,
    pub model: &'a DynModel<Completion>,
    pub request: CompletionRequest,
}

pub(super) fn millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl Journal {
    pub(super) async fn local_result<T: Serialize + DeserializeOwned>(
        &self,
        ordinal: i32,
        stage: &str,
        fingerprint: &str,
        value: T,
    ) -> Result<T, RunFailure> {
        if let Some(saved) = self.result(ordinal, fingerprint).await? {
            return Ok(saved);
        }
        let mut span = self.begin(ordinal, stage, "", "host-1").await?;
        span.request = false;
        self.finish(ordinal, span, Instant::now(), Ok(&value), None)
            .await?;
        Ok(value)
    }
    fn id(&self, ordinal: i32) -> String {
        format!("{}:compact:{ordinal}", self.origin)
    }

    pub(super) async fn plan(&self, items: &[(i32, String, String)]) -> Result<(), RunFailure> {
        let tx = self
            .db
            .begin()
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        runs::lock(&tx, &self.lease, false)
            .await
            .map_err(|_| RunFailure::Cancelled)?;
        for (ordinal, stage, fingerprint) in items {
            if let Some(row) = analysis_window::Entity::find_by_id(self.id(*ordinal))
                .one(&tx)
                .await
                .map_err(|_| RunFailure::StorageFailed)?
            {
                let saved: Entry =
                    serde_json::from_value(row.content).map_err(|_| RunFailure::InvalidResponse)?;
                if saved.format_version != FORMAT
                    || saved.fingerprint != *fingerprint
                    || saved.stage != *stage
                {
                    return Err(RunFailure::StaleProject);
                }
            } else {
                let content = Entry {
                    format_version: FORMAT,
                    fingerprint: fingerprint.clone(),
                    stage: stage.clone(),
                    result: None,
                    spans: vec![],
                };
                analysis_window::ActiveModel {
                    id: Set(self.id(*ordinal)),
                    input_id: Set(self.origin.clone()),
                    ordinal: Set(*ordinal),
                    status: Set("pending".into()),
                    content: Set(
                        serde_json::to_value(content).map_err(|_| RunFailure::StorageFailed)?
                    ),
                }
                .insert(&tx)
                .await
                .map_err(|_| RunFailure::StorageFailed)?;
            }
        }
        runs::commit(tx, &self.lease)
            .await
            .map_err(|_| RunFailure::StorageFailed)
    }

    pub(super) async fn result<T: DeserializeOwned>(
        &self,
        ordinal: i32,
        fingerprint: &str,
    ) -> Result<Option<T>, RunFailure> {
        let row = analysis_window::Entity::find_by_id(self.id(ordinal))
            .one(&self.db)
            .await
            .map_err(|_| RunFailure::StorageFailed)?
            .ok_or(RunFailure::StorageFailed)?;
        let entry: Entry =
            serde_json::from_value(row.content).map_err(|_| RunFailure::InvalidResponse)?;
        if entry.format_version != FORMAT || entry.fingerprint != fingerprint {
            return Err(RunFailure::StaleProject);
        }
        if row.status == "completed" {
            return serde_json::from_value(entry.result.ok_or(RunFailure::InvalidResponse)?)
                .map(Some)
                .map_err(|_| RunFailure::InvalidResponse);
        }
        if entry
            .spans
            .last()
            .is_some_and(|s| !self.explicit_resume || s.run_id == self.lease.run_id())
        {
            return Err(RunFailure::Interrupted);
        }
        Ok(None)
    }

    fn span(&self, stage: &str, prompt: &str, prompt_version: &str, attempt: u32) -> Span {
        Span {
            run_id: self.lease.run_id().into(),
            span_id: uuid::Uuid::new_v4().to_string(),
            parent_span_id: Some(format!("run:{}", self.lease.run_id())),
            stage: stage.into(),
            route: "recommended".into(),
            attempt,
            status: "running".into(),
            started_at: millis(),
            elapsed_ms: 0,
            model: self.limits.model.clone(),
            configuration_hash: self.configuration_hash.clone(),
            prompt_version: prompt_version.into(),
            prompt_hash: crate::project::hash(prompt.as_bytes()),
            protocol_version: "compact-v1".into(),
            source_hash: self.source_hash.clone(),
            usage: Counters::default(),
            error: None,
            request: true,
        }
    }

    async fn begin(
        &self,
        ordinal: i32,
        stage: &str,
        prompt: &str,
        version: &str,
    ) -> Result<Span, RunFailure> {
        let tx = self
            .db
            .begin()
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        runs::lock(&tx, &self.lease, false)
            .await
            .map_err(|_| RunFailure::Cancelled)?;
        let row = analysis_window::Entity::find_by_id(self.id(ordinal))
            .one(&tx)
            .await
            .map_err(|_| RunFailure::StorageFailed)?
            .ok_or(RunFailure::StorageFailed)?;
        let mut entry: Entry =
            serde_json::from_value(row.content.clone()).map_err(|_| RunFailure::InvalidResponse)?;
        if entry.result.is_some()
            || entry
                .spans
                .last()
                .is_some_and(|s| s.run_id == self.lease.run_id())
        {
            return Err(RunFailure::Interrupted);
        }
        let span = self.span(stage, prompt, version, entry.spans.len() as u32 + 1);
        entry.spans.push(span.clone());
        let mut update = row.into_active_model();
        update.status = Set("running".into());
        update.content = Set(serde_json::to_value(entry).map_err(|_| RunFailure::StorageFailed)?);
        update
            .update(&tx)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        runs::commit(tx, &self.lease)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        Ok(span)
    }

    async fn finish<T: Serialize>(
        &self,
        ordinal: i32,
        mut span: Span,
        started: Instant,
        result: Result<&T, RunFailure>,
        usage: Option<&Usage>,
    ) -> Result<(), RunFailure> {
        let tx = self
            .db
            .begin()
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        runs::lock(&tx, &self.lease, true)
            .await
            .map_err(|_| RunFailure::Cancelled)?;
        let run = ai_run::Entity::find_by_id(self.lease.run_id())
            .one(&tx)
            .await
            .map_err(|_| RunFailure::StorageFailed)?
            .ok_or(RunFailure::Cancelled)?;
        let result = if self.token.is_cancelled() || run.cancel_requested {
            Err(RunFailure::Cancelled)
        } else {
            result
        };
        span.elapsed_ms = started.elapsed().as_millis() as u64;
        span.status = match result {
            Ok(_) => "completed",
            Err(RunFailure::Cancelled) => "cancelled",
            Err(_) => "failed",
        }
        .into();
        span.error = result.as_ref().err().copied();
        span.usage = usage.map(Counters::from).unwrap_or_default();
        let row = analysis_window::Entity::find_by_id(self.id(ordinal))
            .one(&tx)
            .await
            .map_err(|_| RunFailure::StorageFailed)?
            .ok_or(RunFailure::StorageFailed)?;
        let mut entry: Entry =
            serde_json::from_value(row.content.clone()).map_err(|_| RunFailure::InvalidResponse)?;
        if entry.spans.last().map(|s| &s.span_id) != Some(&span.span_id) {
            return Err(RunFailure::StaleProject);
        }
        entry.result = result
            .as_ref()
            .ok()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| RunFailure::StorageFailed)?;
        if let Some(last) = entry.spans.last_mut() {
            *last = span.clone();
        }
        let mut update = row.into_active_model();
        update.status = Set(span.status.clone());
        update.content = Set(serde_json::to_value(entry).map_err(|_| RunFailure::StorageFailed)?);
        update
            .update(&tx)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        runs::commit(tx, &self.lease)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        result.map(|_| ())
    }

    pub(super) async fn call<
        T: Serialize + DeserializeOwned,
        F: FnOnce(Value) -> Result<T, RunFailure>,
    >(
        &self,
        call: Call<'_>,
        decode: F,
    ) -> Result<T, RunFailure> {
        let Call {
            ordinal,
            stage,
            fingerprint,
            prompt,
            version,
            model,
            request,
        } = call;
        if let Some(saved) = self.result(ordinal, fingerprint).await? {
            return Ok(saved);
        }
        let global = tokio::select! {biased; ()=self.token.cancelled()=>return Err(RunFailure::Cancelled),
        permit=self.limits.global.clone().acquire_owned()=>permit.map_err(|_|RunFailure::Cancelled)?};
        let connection = tokio::select! {biased; ()=self.token.cancelled()=>return Err(RunFailure::Cancelled),
        permit=self.limits.connection.clone().acquire_owned()=>permit.map_err(|_|RunFailure::Cancelled)?};
        if self.token.is_cancelled() {
            return Err(RunFailure::Cancelled);
        }
        let span = self.begin(ordinal, stage, prompt, version).await?;
        let started = Instant::now();
        let bytes = serde_json::to_vec(&request)
            .map_err(|_| RunFailure::InvalidResponse)?
            .len();
        let mut usage = None;
        let result = async {
            self.output.start(bytes.try_into().map_err(|_|RunFailure::BudgetExhausted)?).await
                .map_err(|_|RunFailure::StorageFailed)?;
            let response = tokio::select! {biased; ()=self.token.cancelled()=>return Err(RunFailure::Cancelled),
                response=crate::llm::complete(model,request)=>response.map_err(super::execution::provider_failure)?};
            usage = Some(response.usage);
            #[cfg(test)]
            crate::llm::test_support::public_diagnostic(
                &format!("compact-{stage}-{}", span.span_id), response.text().as_bytes());
            self.output.usage(&response.usage).await.map_err(|_|RunFailure::StorageFailed)?;
            decode(serde_json::from_str(&response.text()).map_err(|_|RunFailure::InvalidResponse)?)
        }.await;
        let saved = self
            .finish(
                ordinal,
                span,
                started,
                result.as_ref().map_err(|e| *e),
                usage.as_ref(),
            )
            .await;
        drop(connection);
        drop(global);
        saved?;
        result
    }

    pub(super) async fn record_local(
        &self,
        stage: &str,
        started_at: u64,
        elapsed_ms: u64,
        error: Option<RunFailure>,
    ) -> Result<(), RunFailure> {
        let tx = self
            .db
            .begin()
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        runs::lock(&tx, &self.lease, true)
            .await
            .map_err(|_| RunFailure::Cancelled)?;
        self.record_local_in(&tx, stage, started_at, elapsed_ms, error)
            .await?;
        runs::commit(tx, &self.lease)
            .await
            .map_err(|_| RunFailure::StorageFailed)
    }

    /// Called only inside the already-fenced publication transaction.
    pub(super) async fn record_local_in(
        &self,
        db: &impl ConnectionTrait,
        stage: &str,
        started_at: u64,
        elapsed_ms: u64,
        error: Option<RunFailure>,
    ) -> Result<(), RunFailure> {
        let mut span = self.span(stage, "", "host-1", 1);
        span.started_at = started_at;
        span.elapsed_ms = elapsed_ms;
        span.error = error;
        span.status = if error.is_some() {
            "failed"
        } else {
            "completed"
        }
        .into();
        span.request = false;
        let row = analysis_window::Entity::find_by_id(self.id(-3))
            .one(db)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        if let Some(row) = row {
            let mut entry: Entry = serde_json::from_value(row.content.clone())
                .map_err(|_| RunFailure::InvalidResponse)?;
            entry.spans.push(span);
            let mut update = row.into_active_model();
            update.content =
                Set(serde_json::to_value(entry).map_err(|_| RunFailure::StorageFailed)?);
            update
                .update(db)
                .await
                .map_err(|_| RunFailure::StorageFailed)?;
        } else {
            let entry = Entry {
                format_version: FORMAT,
                fingerprint: "host-trace-v1".into(),
                stage: "host".into(),
                result: None,
                spans: vec![span],
            };
            analysis_window::ActiveModel {
                id: Set(self.id(-3)),
                input_id: Set(self.origin.clone()),
                ordinal: Set(-3),
                status: Set("completed".into()),
                content: Set(serde_json::to_value(entry).map_err(|_| RunFailure::StorageFailed)?),
            }
            .insert(db)
            .await
            .map_err(|_| RunFailure::StorageFailed)?;
        }
        Ok(())
    }
}

/// No source text, names or model response bodies are exposed by this projection.
pub(super) async fn diagnostics(
    db: &impl ConnectionTrait,
    run_id: &str,
) -> Result<Value, super::types::AnalysisError> {
    let input = super::input::read(db, run_id)
        .await
        .map_err(|_| super::types::AnalysisError::ReadFailed)?;
    let origin = input.resume_input_id.as_deref().unwrap_or(run_id);
    let rows = analysis_window::Entity::find()
        .filter(analysis_window::Column::InputId.eq(origin))
        .order_by_asc(analysis_window::Column::Ordinal)
        .all(db)
        .await?;
    let mut spans = Vec::new();
    let mut review = None;
    for row in rows {
        if row.content.get("formatVersion").and_then(Value::as_u64) != Some(u64::from(FORMAT)) {
            continue;
        }
        let entry: Entry = serde_json::from_value(row.content)
            .map_err(|_| super::types::AnalysisError::InvalidData)?;
        spans.extend(entry.spans);
        if entry.stage == "review" && row.ordinal == -1 {
            review = entry.result.map(|value|json!({"status":"completed", "issues":value["issues"].as_array().map(Vec::len)}));
        }
    }
    let mut roots = std::collections::BTreeSet::new();
    roots.insert(run_id.to_owned());
    for span in &spans {
        roots.insert(span.run_id.clone());
    }
    let mut root_values = Vec::new();
    for id in roots {
        let run = ai_run::Entity::find_by_id(&id)
            .one(db)
            .await?
            .ok_or(super::types::AnalysisError::NotFound)?;
        let start = run
            .created_at
            .parse::<f64>()
            .map_err(|_| super::types::AnalysisError::InvalidData)?;
        let end = run
            .finished_at
            .as_deref()
            .map(str::parse::<f64>)
            .transpose()
            .map_err(|_| super::types::AnalysisError::InvalidData)?
            .unwrap_or(millis() as f64 / 1000.0);
        root_values.push(
            json!({"runId":id,"spanId":format!("run:{id}"),"parentSpanId":null,
            "stage":"workflow","route":"recommended","attempt":1,"status":run.status,
            "startedAt":(start*1000.0) as u64,"elapsedMs":((end-start).max(0.0)*1000.0) as u64}),
        );
    }
    Ok(json!({"version":1,"originRunId":origin,"spans":spans,"runs":root_values,"review":review}))
}

pub(super) async fn review(
    db: &impl ConnectionTrait,
    run_id: &str,
) -> Result<Option<Value>, super::types::AnalysisError> {
    let input = super::input::read(db, run_id)
        .await
        .map_err(|_| super::types::AnalysisError::NotFound)?;
    let origin = input.resume_input_id.as_deref().unwrap_or(run_id);
    let row = analysis_window::Entity::find_by_id(format!("{origin}:compact:-1"))
        .one(db)
        .await?;
    row.map(|row| {
        let entry: Entry = serde_json::from_value(row.content)
            .map_err(|_| super::types::AnalysisError::InvalidData)?;
        Ok(entry.result)
    })
    .transpose()
    .map(Option::flatten)
}
