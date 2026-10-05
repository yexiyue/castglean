# CastGlean repository guidance

This repository is currently in the planning phase. Read `README.md` and `docs/project-plan.md` before implementing behavior. Do not describe planned commands or integrations as shipped features.

- Use Rust library + CLI as the first implementation target. Prefer deterministic workflows before optional bounded tool loops.
- Keep source text immutable. Bind annotations to a source hash and validate UTF-8 byte ranges and references.
- Keep stable character identity separate from names, narration roles and backend-specific voices.
- Preserve human corrections. Model suggestions must pass application validation before commit.
- Keep credentials, model weights, private novel text and run output out of Git.
- Maintain plain versioned JSON and illustrative samples together; the current samples are not a frozen schema.
- Use Mermaid for diagrams. Track implementation status honestly in the README roadmap.
- Follow `docs/brand.md`; final image assets and generation records live under `assets/brand/`.
- Once Rust code exists, establish workspace tests, formatting, Clippy and rustdoc checks before shipping. No Rust build currently exists.
