//! Explicit CLI-only failure report policy.
use crate::cli::CliError;
use castglean_core::{AnalysisFailureDiagnostics, WorkflowFailure};
use std::{fs::OpenOptions, path::Path};

pub(crate) fn check(path: Option<&Path>) -> Result<(), CliError> {
    if let Some(path) = path {
        crate::publication::ensure_absent(path)?;
    }
    Ok(())
}
pub(crate) fn report_and_unwrap<E>(failure: WorkflowFailure<E>, path: Option<&Path>) -> E {
    if let (Some(path), Some(report)) = (path, failure.diagnostics())
        && let Err(error) = save(path, report)
    {
        eprintln!("Failure report could not be written: {error}");
    }
    failure.into_error()
}
fn save(
    path: &Path,
    report: &AnalysisFailureDiagnostics,
) -> Result<(), Box<dyn std::error::Error>> {
    let file = OpenOptions::new().write(true).create_new(true).open(path)?;
    castglean_core::write_json(&file, report)?;
    file.sync_all()?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn existing_report_is_rejected_without_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("failure.json");
        std::fs::write(&path, "keep").unwrap();
        assert!(check(Some(&path)).is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "keep");
    }
}
