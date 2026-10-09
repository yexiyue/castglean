//! Same-parent staging and complete new-directory publication, shared by CLI actions.
use crate::cli::CliError;
use castglean_core::write_json;
use std::{
    fs::{self, File},
    io,
    path::{Path, PathBuf},
};
/// Stage every artifact before a same-parent directory rename; no overwrites.
pub(crate) fn publish(
    output: &Path,
    write: impl FnOnce(&Path) -> Result<(), CliError>,
) -> Result<(), CliError> {
    ensure_absent(output)?;
    let parent = output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent).map_err(|source| io_error(parent, source))?;
    let staging = tempfile::Builder::new()
        .prefix(".castglean-")
        .tempdir_in(parent)
        .map_err(|source| io_error(parent, source))?;
    write(staging.path())?;
    ensure_absent(output)?;
    fs::rename(staging.path(), output).map_err(|source| io_error(output, source))?;
    Ok(())
}

pub(crate) fn ensure_absent(path: &Path) -> Result<(), CliError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Err(io_error(
            path,
            io::Error::new(io::ErrorKind::AlreadyExists, "output path already exists"),
        )),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io_error(path, e)),
    }
}
pub(crate) fn save(path: PathBuf, value: &impl serde::Serialize) -> Result<(), CliError> {
    let file = File::create(&path).map_err(|source| io_error(&path, source))?;
    write_json(file, value).map_err(|source| CliError::Data { path, source })
}
pub(crate) fn io_error(path: &Path, source: io::Error) -> CliError {
    CliError::Io {
        path: path.to_owned(),
        source,
    }
}
