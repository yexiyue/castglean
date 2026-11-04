//! IPC owns file selection; the project module owns format validation and atomic publication.
use crate::project::{self, ProjectDocument, ProjectError, ProjectInput, ProjectReceipt};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
#[specta::specta]
pub(crate) async fn save_project(
    app: tauri::AppHandle,
    project: ProjectInput,
) -> Result<Option<ProjectReceipt>, ProjectError> {
    tauri::async_runtime::spawn_blocking(move || {
        let document = ProjectDocument::create(project)?;
        let Some(path) = app
            .dialog()
            .file()
            .add_filter("CastGlean", &["castglean"])
            .set_file_name(project::filename(&document.project.title))
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let mut path = path.into_path().map_err(|_| ProjectError::DialogFailed)?;
        if path.extension().is_none() {
            path.set_extension("castglean");
        }
        project::save(&path, &document)?;
        Ok(Some(ProjectReceipt {
            document,
            filename: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
        }))
    })
    .await
    .map_err(|_| ProjectError::WriteFailed)?
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn open_project(
    app: tauri::AppHandle,
) -> Result<Option<ProjectReceipt>, ProjectError> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .add_filter("CastGlean", &["castglean"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|_| ProjectError::DialogFailed)?;
        let document = project::read(&path)?;
        Ok(Some(ProjectReceipt {
            document,
            filename: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
        }))
    })
    .await
    .map_err(|_| ProjectError::ReadFailed)?
}
