# CastGlean repository guidance

This repository implements Stage A offline data validation and Stage B bounded GLM chapter analysis as a Rust library + CLI. Read `README.md`, `docs/project-plan.md`, and `docs/data-format.md` before implementing behavior. Do not describe planned commands or integrations as shipped features.

- Use Rust library + CLI as the first implementation target. Prefer deterministic workflows before optional bounded tool loops.
- Design CastGlean as an independent, reusable library; keep the CLI a thin adapter over the same workflows. Use explicit host-provided configuration and state, and reuse the host async runtime. TRNovel is the planned first consumer, integrated only after standalone capabilities are validated; do not couple core APIs to its types, storage paths or TTS behavior. Follow `docs/implementation-roadmap.md` for implementation order.
- Keep source text immutable. Bind annotations to a source hash and validate UTF-8 byte ranges and references.
- Keep stable character identity separate from names, narration roles and backend-specific voices.
- Preserve human corrections. Model suggestions must pass application validation before commit.
- Keep credentials, model weights, private novel text and run output out of Git.
- Maintain plain versioned JSON and illustrative samples together; the current samples are not a frozen schema.
- Use Mermaid for diagrams. Track implementation status honestly in the README roadmap.
- Follow `docs/brand.md`; final image assets and generation records live under `assets/brand/`.
- Keep workspace tests, formatting, Clippy and rustdoc checks passing. The CLI provides help, version, explicit-file validate and GLM analyze. Source/domain/JSON/validation and bounded analysis APIs exist; correction/state workflows remain planned. Keep generated schemas and public examples synchronized with draft DTOs.
- Use named module files (`foo.rs`, with `foo/bar.rs` for children). Keep modules private by default and expose intentional APIs through re-exports. Crate directories are `crates/core`, `crates/model`, and `crates/cli`; Cargo package names retain the `castglean-` prefix. See `docs/engineering.md` for module and test conventions.
- Write OpenSpec proposal, design, spec and task content in Chinese. Keep parser-required structural markers and protocol/code identifiers unchanged.
