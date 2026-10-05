# CastGlean repository guidance

This repository has an initial Rust library + CLI scaffold. Read `README.md` and `docs/project-plan.md` before implementing behavior. Do not describe planned commands or integrations as shipped features.

- Use Rust library + CLI as the first implementation target. Prefer deterministic workflows before optional bounded tool loops.
- Design library APIs first for the initial consumer `../TRNovel`; keep the CLI a thin adapter over the same library workflows. Prefer direct Rust integration, explicit host-provided configuration and state, and reuse the host async runtime. Do not put business behavior only in CLI code.
- Keep source text immutable. Bind annotations to a source hash and validate UTF-8 byte ranges and references.
- Keep stable character identity separate from names, narration roles and backend-specific voices.
- Preserve human corrections. Model suggestions must pass application validation before commit.
- Keep credentials, model weights, private novel text and run output out of Git.
- Maintain plain versioned JSON and illustrative samples together; the current samples are not a frozen schema.
- Use Mermaid for diagrams. Track implementation status honestly in the README roadmap.
- Follow `docs/brand.md`; final image assets and generation records live under `assets/brand/`.
- Keep workspace tests, formatting, Clippy and rustdoc checks passing. The CLI currently provides help and version only; business modules remain placeholders.
- Use named module files (`foo.rs`, with `foo/bar.rs` for children). Keep modules private by default and expose intentional APIs through re-exports. Crate directories are `crates/core`, `crates/model`, and `crates/cli`; Cargo package names retain the `castglean-` prefix. See `docs/engineering.md` for module and test conventions.
