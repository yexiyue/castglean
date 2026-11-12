//! Storage roots fixed for the lifetime of one desktop process.
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(serde::Serialize, specta::Type)]
pub(crate) struct StorageLocations {
    active_data: PathBuf,
    active_cache: PathBuf,
    default_data: PathBuf,
    default_cache: PathBuf,
}

#[tauri::command]
#[specta::specta]
pub(crate) fn storage_locations(app: tauri::AppHandle) -> Result<StorageLocations, String> {
    let roots = app.state::<StorageRoots>();
    Ok(StorageLocations {
        active_data: roots.data.clone(),
        active_cache: roots.cache.clone(),
        default_data: app
            .path()
            .app_data_dir()
            .map_err(|_| "storage unavailable")?,
        default_cache: app
            .path()
            .app_cache_dir()
            .map_err(|_| "storage unavailable")?,
    })
}

pub(crate) struct StorageRoots {
    pub(crate) data: PathBuf,
    pub(crate) cache: PathBuf,
}

impl StorageRoots {
    pub(crate) fn resolve(
        settings: &crate::engine::config::EngineSettings,
        default_data: &Path,
        default_cache: &Path,
        default_hub: &Path,
    ) -> anyhow::Result<Self> {
        let data = settings
            .data_dir
            .clone()
            .unwrap_or_else(|| default_data.to_owned());
        let cache = settings
            .app_cache_dir
            .clone()
            .unwrap_or_else(|| default_cache.to_owned());
        talechime::Registry::with_storage_paths(
            data.clone(),
            cache.clone(),
            &settings.download_config(default_hub)?,
            Default::default(),
        )?;
        Ok(Self { data, cache })
    }
}

pub(crate) fn init(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let paths = app.path();
    let settings = crate::engine::config::load(&paths.app_config_dir()?.join("engine.json"));
    let roots = StorageRoots::resolve(
        &settings,
        &paths.app_data_dir()?,
        &paths.app_cache_dir()?,
        &paths.home_dir()?.join(".cache/huggingface/hub"),
    )?;
    app.manage(roots);
    Ok(())
}

pub(crate) fn data(app: &tauri::AppHandle) -> PathBuf {
    app.state::<StorageRoots>().data.clone()
}
pub(crate) fn cache(app: &tauri::AppHandle) -> PathBuf {
    app.state::<StorageRoots>().cache.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roots_are_independent_and_existing_data_is_left_in_place() {
        let temp = tempfile::tempdir().unwrap();
        let old = temp.path().join("old");
        std::fs::create_dir(&old).unwrap();
        std::fs::write(old.join("voice"), b"keep").unwrap();
        let settings = crate::engine::config::EngineSettings {
            data_dir: Some(temp.path().join("new")),
            app_cache_dir: Some(temp.path().join("cache")),
            ..Default::default()
        };
        let roots = StorageRoots::resolve(
            &settings,
            &old,
            &temp.path().join("old-cache"),
            &temp.path().join("hub"),
        )
        .unwrap();
        assert_eq!(roots.data, temp.path().join("new"));
        assert_eq!(std::fs::read(old.join("voice")).unwrap(), b"keep");
        let overlap = crate::engine::config::EngineSettings {
            app_cache_dir: Some(roots.data.join("nested")),
            ..settings
        };
        assert!(
            StorageRoots::resolve(
                &overlap,
                &old,
                &temp.path().join("old-cache"),
                &temp.path().join("hub")
            )
            .is_err()
        );
    }
}
