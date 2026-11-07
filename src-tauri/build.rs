fn main() {
    #[cfg(windows)]
    {
        // Integration tests link the dialog handlers but do not receive Tauri's
        // application manifest. TaskDialogIndirect requires Common Controls v6.
        let manifest =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-test.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
            manifest.display()
        );
    }
    tauri_build::build()
}
