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
    fn sources(path: &std::path::Path, files: &mut Vec<std::path::PathBuf>) {
        if path.is_dir() {
            for entry in std::fs::read_dir(path).expect("source directory") {
                sources(&entry.expect("source entry").path(), files);
            }
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            files.push(path.to_owned());
        }
    }
    let mut files = Vec::new();
    sources(std::path::Path::new("src"), &mut files);
    files.extend(["Cargo.toml", "Cargo.lock", "build.rs"].map(std::path::PathBuf::from));
    files.sort();
    for file in files {
        hash.update(file.to_string_lossy().as_bytes());
        hash.update(std::fs::read(file).expect("compiled source input"));
    }
    println!(
        "cargo:rustc-env=CASTGLEAN_CODE_REVISION={revision}+source-{:x}",
        hash.finalize()
    );
}
