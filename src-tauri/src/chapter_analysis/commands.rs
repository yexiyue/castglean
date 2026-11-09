//! Thin IPC boundary: domain queries run outside the WebView and return no paths.
use super::{query, types::*};
use sea_orm::DatabaseConnection;
use std::path::PathBuf;
use tauri::Manager;

fn resources(app: &tauri::AppHandle) -> Result<(DatabaseConnection, PathBuf), AnalysisError> {
    Ok((
        app.state::<DatabaseConnection>().inner().clone(),
        app.path()
            .app_data_dir()
            .map_err(|_| AnalysisError::ReadFailed)?
            .join("project-sources"),
    ))
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_run_diagnostics(
    db: tauri::State<'_, DatabaseConnection>,
    run_id: String,
) -> Result<AnalysisDiagnosticDocument, AnalysisError> {
    Ok(AnalysisDiagnosticDocument {
        version: 1,
        data: super::observation::run(db.inner(), &run_id).await?,
    })
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_ai_review(
    db: tauri::State<'_, DatabaseConnection>,
    run_id: String,
) -> Result<Option<AnalysisDiagnosticDocument>, AnalysisError> {
    Ok(super::observation::review(db.inner(), &run_id)
        .await?
        .map(|data| AnalysisDiagnosticDocument { version: 1, data }))
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_snapshot(
    app: tauri::AppHandle,
    project_id: String,
    chapter_id: String,
) -> Result<query::AnalysisSnapshot, AnalysisError> {
    let (db, root) = resources(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(query::snapshot(&db, &root, &project_id, &chapter_id))
    })
    .await
    .map_err(|_| AnalysisError::ReadFailed)?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_segments(
    app: tauri::AppHandle,
    project_id: String,
    version_id: String,
    range: ByteRange,
    after: Option<u32>,
) -> Result<query::SegmentPage, AnalysisError> {
    let (db, root) = resources(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(query::segments(
            &db,
            &root,
            &project_id,
            &version_id,
            range,
            after,
        ))
    })
    .await
    .map_err(|_| AnalysisError::ReadFailed)?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_characters(
    db: tauri::State<'_, DatabaseConnection>,
    project_id: String,
) -> Result<Vec<Character>, AnalysisError> {
    query::characters(db.inner(), &project_id).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_edit(
    app: tauri::AppHandle,
    project_id: String,
    chapter_id: String,
    command_id: String,
    expected_revision: u32,
    edit: super::edits::Edit,
) -> Result<crate::project::receipts::CommandResult, AnalysisError> {
    let (db, root) = resources(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(super::edits::apply(
            &db,
            &root,
            &project_id,
            &chapter_id,
            &command_id,
            expected_revision,
            edit,
        ))
    })
    .await
    .map_err(|_| AnalysisError::WriteFailed)?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_start(
    app: tauri::AppHandle,
    request: crate::ai::StartRun,
) -> Result<crate::ai::RunInfo, crate::ai::AiError> {
    use std::sync::Arc;
    let db = app.state::<DatabaseConnection>();
    if let Some(run) = crate::ai::replay_request(db.inner(), &request).await? {
        let input = super::input::read(db.inner(), &run.id).await?;
        if input.action != super::input::Action::Analyze {
            return Err(crate::ai::AiError::Conflict);
        }
        return Ok(run);
    }
    let llm = app.state::<Arc<crate::llm::LlmState>>();
    let connection = llm
        .acquire(&request.configuration.selection)
        .map_err(|_| crate::ai::AiError::ConfigurationUnavailable)?;
    if connection.connection.revision != request.configuration.revision {
        return Err(crate::ai::AiError::ConfigurationChanged);
    }
    let result = crate::ai::start_analysis_run(db.inner(), request).await?;
    let _ = app
        .state::<Arc<crate::ai::stream::Hub>>()
        .publish(&result.session_id)
        .await;
    app.state::<Arc<crate::jobs::Runtime>>().wake();
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_candidate(
    db: tauri::State<'_, DatabaseConnection>,
    project_id: String,
    candidate_id: String,
) -> Result<super::candidates::Candidate, AnalysisError> {
    super::candidates::read(db.inner(), &project_id, &candidate_id).await
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_candidate_process(
    app: tauri::AppHandle,
    project_id: String,
    candidate_id: String,
    command_id: String,
    expected_revision: u32,
    selected: Option<Vec<String>>,
    allow_conflicts: Vec<String>,
) -> Result<crate::project::receipts::CommandResult, AnalysisError> {
    let (db, root) = resources(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(super::candidates::process(
            &db,
            &root,
            &project_id,
            &candidate_id,
            &command_id,
            expected_revision,
            super::candidates::Decision {
                selected,
                allow_conflicts,
            },
        ))
    })
    .await
    .map_err(|_| AnalysisError::WriteFailed)?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_character_usage(
    db: tauri::State<'_, DatabaseConnection>,
    project_id: String,
    character_id: String,
) -> Result<Vec<super::characters::CharacterUsage>, AnalysisError> {
    super::characters::usage(db.inner(), &project_id, &character_id).await
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_character_edit(
    app: tauri::AppHandle,
    project_id: String,
    character_id: String,
    command_id: String,
    expected_revision: u32,
    edit: super::characters::CharacterEdit,
) -> Result<crate::project::receipts::CommandResult, AnalysisError> {
    let (db, root) = resources(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(super::characters::edit(
            &db,
            &root,
            &project_id,
            &character_id,
            &command_id,
            expected_revision,
            edit,
        ))
    })
    .await
    .map_err(|_| AnalysisError::WriteFailed)?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_directory(
    db: tauri::State<'_, DatabaseConnection>,
    project_id: String,
) -> Result<Vec<query::DirectorySummary>, AnalysisError> {
    query::directory(db.inner(), &project_id).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_excerpt(
    app: tauri::AppHandle,
    project_id: String,
    chapter_id: String,
    range: ByteRange,
) -> Result<query::Excerpt, AnalysisError> {
    let (db, root) = resources(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(query::excerpt(&db, &root, &project_id, &chapter_id, range))
    })
    .await
    .map_err(|_| AnalysisError::ReadFailed)?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_progress(
    db: tauri::State<'_, DatabaseConnection>,
    run_id: String,
) -> Result<super::observation::Progress, AnalysisError> {
    super::observation::progress(db.inner(), &run_id).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_issues(
    app: tauri::AppHandle,
    project_id: String,
    chapter_id: Option<String>,
    after: Option<query::IssueCursor>,
    search: String,
) -> Result<query::IssuePage, AnalysisError> {
    let (db, root) = resources(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(query::issues(
            &db,
            &root,
            &project_id,
            chapter_id.as_deref(),
            after,
            &search,
        ))
    })
    .await
    .map_err(|_| AnalysisError::ReadFailed)?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_character_aliases(
    db: tauri::State<'_, DatabaseConnection>,
    project_id: String,
    character_id: String,
) -> Result<Vec<super::characters::AliasView>, AnalysisError> {
    super::characters::aliases(db.inner(), &project_id, &character_id).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_versions(
    db: tauri::State<'_, DatabaseConnection>,
    project_id: String,
    after: Option<super::history::VersionCursor>,
) -> Result<super::history::VersionPage, AnalysisError> {
    super::history::list(db.inner(), &project_id, after).await
}
#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_version_excerpt(
    app: tauri::AppHandle,
    project_id: String,
    version_id: String,
    range: ByteRange,
) -> Result<query::Excerpt, AnalysisError> {
    let (db, root) = resources(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(super::history::excerpt(
            &db,
            &root,
            &project_id,
            &version_id,
            range,
        ))
    })
    .await
    .map_err(|_| AnalysisError::ReadFailed)?
}

/// Resolve result ownership on the host; the visible chapter is never the authority.
#[tauri::command]
#[specta::specta]
pub(crate) async fn chapter_analysis_result_target(
    db: tauri::State<'_, DatabaseConnection>,
    project_id: String,
    result_id: String,
) -> Result<SourceBinding, AnalysisError> {
    use crate::database::entity::analysis_candidate;
    use sea_orm::EntityTrait;
    let version_id = if let Some(candidate) = analysis_candidate::Entity::find_by_id(&result_id)
        .one(db.inner())
        .await?
    {
        if candidate.project_id != project_id {
            return Err(AnalysisError::NotFound);
        }
        candidate.version_id
    } else {
        result_id
    };
    Ok(query::version(db.inner(), &project_id, &version_id)
        .await?
        .dependencies
        .source)
}
