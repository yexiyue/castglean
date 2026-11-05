# CastGlean repository guidance

CastGlean is a desktop audiobook production app under development. The repository was restarted on 2026-11-02 on a fresh Tauri 2 scaffold (React 19 + TypeScript + Vite, pnpm); no product features are implemented yet. The pre-restart library-first implementation (analysis crates, schemas, examples and the auxiliary CLI) is preserved read-only on the `legacy-main` branch for reference; do not build on it or resurrect it. Follow `docs/desktop-studio/technology-choice.md` for UI/runtime boundaries and responsiveness validation. Read `README.md`, `docs/desktop-studio/README.md`, `docs/desktop-studio/execution-and-roadmap.md`, and `docs/data-format.md` before implementing behavior; these docs were written before the restart and still describe the legacy structure in places — update them as the new implementation lands. `docs/archive/project-plan.md` preserves the earlier library-first plan. Do not describe planned commands or integrations as shipped features.

- The voice engine is integrated as a path dependency on the sibling TaleChime checkout (`src-tauri/Cargo.toml`: `../../talechime/crates/talechime`, CPU backends: MOSS, Kokoro, Qwen, IndexTTS, CosyVoice3, VoxCPM and OmniVoice; Metal is macOS-target-scoped). The host must repeat TaleChime's `[patch.crates-io]` candle fork pins — patches do not cross workspaces. Engine objects are non-Send `Rc`s and live only on the dedicated engine thread (`src-tauri/src/engine/resources.rs`); IPC talks to it over channels. Model weights download through hf-hub into the shared Hugging Face cache and hardlink into the app's engine layout; engine-internal types must not leak into `bindings.ts`.
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

## UI 与 UX

- UI 工作遵循 [Uncodixfy](https://github.com/cyxzdev/Uncodixfy)：优先清晰、克制、可操作的工具界面，沿用项目主题 token 和已有组件。
- 避免装饰渐变、玻璃面板、过大圆角、悬浮外壳、无意义动效、营销式大标题和反复解释界面的文案。
- 导航直接显示名称；模型、音色等共享资源有稳定入口，不依赖悬停或状态菜单才能发现。
- 集合优先使用可扫描的列表；用间距和分隔线表达分组，不把每个设置或页面分区都包装成卡片。
- 区分浏览器预览、桌面宿主不可用、真实空目录和读取失败；不伪造模型、进度、保存成功或可用操作，不把底层 IPC 异常直接显示给用户。
- 示例工程与真实工程分开；导入原文不以模型准备或服务配置为前提。
- 修改后验证真实页面、关键交互、小窗口、亮暗主题和中英文文案；不为旧界面保留兼容层，不改变或删除用户工程数据。
