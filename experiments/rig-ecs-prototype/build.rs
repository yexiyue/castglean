//! Bind checkpoints to actual compiled source, including dirty worktree changes.
use sha2::{Digest, Sha256};
fn main() {
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=Cargo.lock");
    println!("cargo:rerun-if-changed=build.rs");
    let revision = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
        .unwrap_or_else(|| "no-git".into());
    let mut hash = Sha256::new();
    for file in [
        "src/main.rs",
        "src/contract.rs",
        "src/driver.rs",
        "src/journal.rs",
        "src/kernel.rs",
        "Cargo.toml",
        "Cargo.lock",
        "build.rs",
    ] {
        hash.update(file.as_bytes());
        hash.update(std::fs::read(file).unwrap_or_default());
    }
    println!(
        "cargo:rustc-env=CASTGLEAN_CODE_REVISION={revision}+source-{:x}",
        hash.finalize()
    );
}
