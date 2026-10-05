//! Process-level checks for the available command-line interface.

use std::process::Command;

#[test]
fn help_describes_the_current_scope() {
    let output = Command::new(env!("CARGO_BIN_EXE_castglean"))
        .arg("--help")
        .output()
        .expect("CLI should start");

    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).expect("help should be UTF-8");
    assert!(stdout.contains("not implemented yet"));
    assert!(stdout.contains("--version"));
}

#[test]
fn planned_commands_are_rejected() {
    let output = Command::new(env!("CARGO_BIN_EXE_castglean"))
        .arg("analyze")
        .output()
        .expect("CLI should start");

    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
}
