# CastGlean repository guidance

CastGlean is a desktop audiobook production app under development. The repository was restarted on 2026-11-02 on a fresh Tauri 2 scaffold (React 19 + TypeScript + Vite, pnpm); no product features are implemented yet. The pre-restart library-first implementation (analysis crates, schemas, examples and the auxiliary CLI) is preserved read-only on the `legacy-main` branch for reference; do not build on it or resurrect it. Follow `docs/desktop-studio/technology-choice.md` for UI/runtime boundaries and responsiveness validation. Read `README.md`, `docs/desktop-studio/README.md`, `docs/implementation-roadmap.md`, and `docs/data-format.md` before implementing behavior; these docs were written before the restart and still describe the legacy structure in places — update them as the new implementation lands. `docs/project-plan.md` preserves the earlier library-first plan. Do not describe planned commands or integrations as shipped features.

- Prioritize the desktop app's chapter production loop. Rebuild analysis capabilities as `src-tauri` host modules or dedicated crates only when a concrete app workflow requires them, with relevant validation before use. Prefer deterministic workflows before optional bounded tool loops.
- Keep layering strict: the React frontend in `src/` renders and holds only transient UI state; the Tauri Rust host in `src-tauri/` owns project persistence, casting, TTS mapping, candidates, exports and background tasks. Use explicit host-provided configuration and state, and reuse the host async runtime. The host consumes TaleChime without putting backend-specific types in analysis logic. TRNovel is a possible later consumer, not the first-delivery prerequisite.
- Keep source text immutable. Bind annotations to a source hash and validate UTF-8 byte ranges and references.
- Keep stable character identity separate from names, narration roles and backend-specific voices.
- Preserve human corrections. Model suggestions must pass application validation before commit.
- Keep credentials, model weights, private novel text and run output out of Git.
- Maintain plain versioned JSON formats per `docs/data-format.md`; do not treat current drafts as a frozen schema.
- Use Mermaid for diagrams. Track implementation status honestly in the README roadmap.
- Follow `docs/brand.md`; final image assets and generation records live under `assets/brand/`.
- Keep formatting, Clippy, rustdoc and tests passing as real code lands; the scaffold itself carries no product tests yet.
- Use named module files (`foo.rs`, with `foo/bar.rs` for children). Keep modules private by default and expose intentional APIs through re-exports. The Rust host lives in the single `castglean` crate under `src-tauri`. See `docs/engineering.md` for module and test conventions.
- Write OpenSpec proposal, design, spec and task content in Chinese. Keep parser-required structural markers and protocol/code identifiers unchanged.
