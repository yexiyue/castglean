# CastGlean repository guidance

CastGlean is a desktop audiobook production app under development. The repository was restarted on 2026-11-02 on a fresh Tauri 2 scaffold (React 19 + TypeScript + Vite, pnpm); current implementation and validation status live in `README.md`. Follow `docs/desktop-studio/technology-choice.md` for UI/runtime boundaries and responsiveness validation. Read `README.md`, `docs/desktop-studio/README.md`, `docs/desktop-studio/execution-and-roadmap.md`, and `docs/data-format.md` before implementing behavior; keep these documents aligned with the current implementation. Do not describe planned commands or integrations as shipped features.

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
- Keep formatting, Clippy, rustdoc and relevant tests passing; distinguish automated checks, real desktop acceptance and platform limitations.
- Use named module files (`foo.rs`, with `foo/bar.rs` for children). Keep modules private by default and expose intentional APIs through re-exports. The Rust host lives in the single `castglean` crate under `src-tauri`. See `docs/engineering.md` for module and test conventions.
- Write OpenSpec proposal, design, spec and task content in Chinese. Keep parser-required structural markers and protocol/code identifiers unchanged.

## 开发与知识积累工作流

- 开始任务时，先读 [知识库索引](docs/knowledge/README.md)，按任务选择相关规划、决策和踩坑记录，再检查负责该行为的规格、代码与文档。历史结论不是当前实现的证据，依赖版本、平台或实现变化时重新核验。
- 知识库统一放在 `docs/knowledge/`：`plans/` 保存阶段规划与待验证问题，`decisions/` 保存有取舍依据的技术决策，`lessons/` 保存可复现的故障和修复经验。按实际需要建文件，不为每次会话生成流水账。
- 影响功能范围、数据格式、模块边界或恢复语义的工作先落实到对应 OpenSpec；规划笔记明确区分候选、已决定、已实现和已验证。知识库不能代替规格、任务勾选或用户授权。
- 开发中遇到重要决策、非直观约束或反复出现的问题，在相关改动中记录日期、适用版本/平台、触发条件、原因、处理方式、验证证据与未验证边界，并更新知识库索引。优先链接负责该行为的源码、规格和验收文档，不复制大段实现或原始日志；不记录凭据、私人正文、模型权重或运行产物。
- 一项经验经验证且可跨功能复用后，将工程做法整理到 `docs/engineering.md`；只有长期有效、必须遵守的简短约束才提升到 `AGENTS.md`。具体案例和调研依据留在知识库，避免规范不断膨胀。
- 完成改动时，同步检查 OpenSpec 任务、README 状态、所属领域文档和知识库索引。新证据推翻旧结论时标明已替代并链接新结论，同时修正现行规范；保持事实来源明确，不维护互相矛盾的多份规则。

## UI 与 UX

- UI 工作遵循 [Uncodixfy](https://github.com/cyxzdev/Uncodixfy)：优先清晰、克制、可操作的工具界面，沿用项目主题 token 和已有组件。
- 避免装饰渐变、玻璃面板、过大圆角、悬浮外壳、无意义动效、营销式大标题和反复解释界面的文案。
- 导航直接显示名称；模型、音色等共享资源有稳定入口，不依赖悬停或状态菜单才能发现。
- 集合优先使用可扫描的列表；用间距和分隔线表达分组，不把每个设置或页面分区都包装成卡片。
- 区分浏览器预览、桌面宿主不可用、真实空目录和读取失败；不伪造模型、进度、保存成功或可用操作，不把底层 IPC 异常直接显示给用户。
- 示例工程与真实工程分开；导入原文不以模型准备或服务配置为前提。
- 修改后验证真实页面、关键交互、小窗口、亮暗主题和中英文文案；不为旧界面保留兼容层，不改变或删除用户工程数据。
