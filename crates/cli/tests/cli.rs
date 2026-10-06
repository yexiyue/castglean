//! Process-level checks for the available command-line interface.

use std::process::Command;
use std::{fs, path::PathBuf};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn validate(name: &str) -> Command {
    let directory = root().join("examples").join(name);
    let mut command = Command::new(env!("CARGO_BIN_EXE_castglean"));
    command
        .arg("validate")
        .arg("--characters")
        .arg(directory.join("characters.json"))
        .arg("--annotations")
        .arg(directory.join("chapter.annotations.json"))
        .arg("--source")
        .arg(directory.join("chapter.txt"));
    command
}

#[test]
fn help_describes_the_current_scope() {
    let output = Command::new(env!("CARGO_BIN_EXE_castglean"))
        .arg("--help")
        .output()
        .expect("CLI should start");

    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).expect("help should be UTF-8");
    assert!(stdout.contains("Local, GLM and MiniMax analysis"));
    assert!(stdout.contains("--version"));
}

#[test]
fn analyze_requires_explicit_inputs() {
    let output = Command::new(env!("CARGO_BIN_EXE_castglean"))
        .arg("analyze")
        .output()
        .expect("CLI should start");

    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
}

#[test]
fn all_public_samples_validate_without_modifying_inputs() {
    for name in [
        "minimal",
        "ambiguous",
        "quoted",
        "direct",
        "bounded",
        "offscreen",
    ] {
        let directory = root().join("examples").join(name);
        let paths: Vec<_> = ["characters.json", "chapter.annotations.json", "chapter.txt"]
            .map(|name| directory.join(name))
            .into();
        let before: Vec<_> = paths.iter().map(|path| fs::read(path).unwrap()).collect();
        let output = validate(name).output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            String::from_utf8(output.stdout)
                .unwrap()
                .starts_with("Valid:")
        );
        assert!(output.stderr.is_empty());
        assert_eq!(
            before,
            paths
                .iter()
                .map(|path| fs::read(path).unwrap())
                .collect::<Vec<_>>()
        );
    }
}

#[test]
fn semantic_and_structural_failures_have_no_success_output() {
    for name in ["gap", "unknown-field"] {
        let output = Command::new(env!("CARGO_BIN_EXE_castglean"))
            .arg("validate")
            .arg("--characters")
            .arg(root().join("examples/minimal/characters.json"))
            .arg("--annotations")
            .arg(root().join(format!("examples/invalid/{name}.annotations.json")))
            .arg("--source")
            .arg(root().join("examples/minimal/chapter.txt"))
            .output()
            .unwrap();
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(!output.stderr.is_empty());
    }
}

#[test]
fn count_mismatch_and_missing_file_report_useful_errors() {
    let output = validate("minimal")
        .arg("--source")
        .arg("unused.txt")
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("same number"));
    let output = validate("missing-scene").output().unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("characters.json"));
    assert!(output.stdout.is_empty());
}

#[test]
fn changed_snapshot_is_rejected_and_not_rewritten() {
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("chapter.txt");
    fs::write(&path, "改变了原文").unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_castglean"))
        .arg("validate")
        .arg("--characters")
        .arg(root().join("examples/minimal/characters.json"))
        .arg("--annotations")
        .arg(root().join("examples/minimal/chapter.annotations.json"))
        .arg("--source")
        .arg(&path)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("digest mismatch"));
    assert_eq!(fs::read_to_string(path).unwrap(), "改变了原文");
}

#[test]
fn repeated_pairs_validate_multiple_chapters() {
    let temporary = tempfile::tempdir().unwrap();
    let original = root().join("examples/minimal/chapter.annotations.json");
    let mut value: serde_json::Value =
        serde_json::from_slice(&fs::read(&original).unwrap()).unwrap();
    value["chapter_id"] = serde_json::json!("ch-002");
    let second = temporary.path().join("second.json");
    fs::write(&second, serde_json::to_vec(&value).unwrap()).unwrap();
    let output = validate("minimal")
        .arg("--annotations")
        .arg(&second)
        .arg("--source")
        .arg(root().join("examples/minimal/chapter.txt"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("2 chapter(s)"));
}

#[test]
fn bare_command_and_version_remain_available() {
    let output = Command::new(env!("CARGO_BIN_EXE_castglean"))
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("validate"));
    let output = Command::new(env!("CARGO_BIN_EXE_castglean"))
        .arg("--version")
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).starts_with("castglean "));
}
