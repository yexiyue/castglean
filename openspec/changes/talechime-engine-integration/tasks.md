# Tasks

## 1. 引擎侧：下载层替换为 hf-hub（talechime 仓）

- [x] 1.1 talechime workspace 引入 hf-hub 1.0 依赖，`cargo check` 全 workspace 通过
- [x] 1.2 清单瘦身：`resources.json` 条目改为 `repo + revision(commit) + filename`（`size` 保持必填并统一用于就绪判定与空间预检，`sha256` 移除——完整性信任 Hub etag，`url` 删除），更新全部后端清单与解析代码；单测覆盖清单解析与缺字段报错
- [x] 1.3 引擎侧新增下载配置显式注入（实现落点为 `talechime-backends` 的 `DownloadConfig { cache_dir, endpoint, token }` + `Registry::with_downloads`，facade re-export；比原计划的 facade 层更贴近 Registry 所在层），引擎不提供依赖 cwd 的默认值；单测验证 endpoint/token 传入生效
- [x] 1.4 `prepare()` 改走 hf-hub `download_file().revision()`，`ProgressHandler` 桥接为既有 `Event::ModelProgress`（事件协议不变）；下载落共享缓存后经 canonicalize 硬链进引擎布局；集成测试（本地 HTTP 服务作为 endpoint，含 X-Repo-Commit 协议头）：下载落位、已就绪文件二次调用不重下、404 类型化失败
- [x] 1.5 删除手写 `download.rs` 及其测试，`cargo test` 全绿（默认 99+2、特性组合全绿）
- [x] 1.6 新增离线盘点 API：`Registry::resource_status` → `ResourceStatus::{Missing,Partial,Ready}`，按引擎布局逐文件判定（含 CosyVoice3/IndexTTS 本地转换型、Kokoro 磁盘转换清单）；单测覆盖空/部分/全部就绪
- [x] 1.7 冒烟（真实网络，`--ignored` 手动跑）：moss nano 经新下载路径完成 prepare（加载成功即释放），实测 120.3s 完成下载+CPU 加载+释放、资源状态 → Ready、逐文件进度事件流出，权重落共享缓存；kokoro 为本地转换型（无下载路径），冒烟验证其如实报告 Missing

## 2. 宿主：engine 模块骨架与配置（castglean 仓）

- [x] 2.1 `src-tauri/Cargo.toml` 增加 talechime path 依赖（`../../talechime`，兄弟目录）并按 D7 裁剪 feature（kokoro + moss-nano-candle，CPU 路径先行）；宿主重复声明 candle fork 的 `[patch.crates-io]`（跨 workspace 不传递）；`cargo check/test` 通过；二进制体积基线因磁盘满（见下）暂缓至 G4
- [x] 2.2 `src-tauri` 结构调整：`project.rs` + `project/{commands,document}.rs` 具名模块文件（行为不变），engine 平级挂入；既有工程文件测试保持绿
- [x] 2.3 `engine/config.rs`：版本化 JSON 原子读写（tempfile+rename），默认共享 HF 缓存目录显式解析为绝对路径；单测覆盖默认值、往返、损坏回退、相对路径/非法端点拒绝
- [x] 2.4 `engine.rs` + `engine/` 六文件模块（config/catalog/inventory/resources/events/commands）+ 应用语义类型；bindings.ts 重新导出并 grep 验证无 `talechime`/`hf_hub` 泄漏（字节量字段用 f64，规避 specta BigInt 禁令）
- [ ] 2.5 `engine/commands.rs` + `lib.rs` 注册：`list_models`（目录 × 盘点合并快照）、`get/update_engine_settings`、`prepare_model`（含磁盘空间预检）、`cancel_prepare`、`verify_model`（加载即释放冒烟）、`get_storage_status`（确认对话存储概览）、整体进度事件桥（跨文件累计 + 当前文件）；命令与事件已入 bindings，`pnpm tauri dev` 下前端真实调用随 G3 接线验收
- [x] 2.6 错误映射：引擎侧新增类型化 `DownloadFailure`（network/auth/rate_limited/not_found/cache/other，经 anyhow 链传递），宿主 `classify_failure` downcast 映射 `PrepareFailure`（含 InsufficientSpace/Cancelled），凭据不进错误与日志；单测覆盖链式 downcast

## 3. 前端：模型中心真实化

- [x] 3.1 新建 `src/lib/models.ts`（externally-tagged 判别/字节格式化/文案映射）与 `use-model-resources`（快照 + 事件合并，无轮询）；删除 `preview-models.ts`，`model-select`/`voice-library`/`voice-detail-sheet`/`change-voice-dialog`/`model-center`/`voice-studio-page` 与示例音色绑定夹具 id 全部改接真实目录（夹具 id → `moss/nano-candle`）；`pnpm build` 通过
- [x] 3.2 `/models` 重写：五态（未下载/下载中进度/部分就绪/已就绪/失败含类型化原因）、取消、重试/续传、下载前确认（待下载体积 + 存储设置入口 + 空间不足拦截）、空目录/搜索空态；zh 源文案就位，en 目录 49 条新消息待翻译填充
- [x] 3.3 `engine-storage-settings` 组件：缓存目录系统选择器（官方 `@tauri-apps/plugin-dialog` 前端 API + `dialog:default` 权限）+ 恢复默认共享缓存、镜像端点与凭据保存（校验后生效）；持久化经宿主 `engine.json`（重启保持随 4.1 人工验收）
- [x] 3.4 已就绪模型的"验证可用性"按钮（`verify_model`：加载成功即释放，进行中禁用）；无常驻加载状态
- [x] 3.5 模型中心移除失实"示例"文案，保留未接入项说明（更新/移除）；音色创建页"模型能力为界面示例"保留（创建流程仍为夹具，文案属实）；无新增 app-states 变体（复用既有空/搜索/错误态）

## 4. 集成验收与文档

- [ ] 4.1 端到端人工验收并记录：官方端点与镜像端点各完成一次真实下载（含进度显示）、中途取消 → 部分就绪 → 续齐 → 已就绪 → 重启后状态一致
- [ ] 4.2 失败路径人工验收并记录：断网中断（重试入口）、无效 token（引导设置）均给出类型化反馈且已就绪文件不受损
- [x] 4.3 文档更新：README（当前状态/`/models` 预览/路线图 B1 勾选）、`docs/desktop-studio/interaction-design.md` 模型中心章节改「已接入」并保留未完成项（更新/移除/云端分类/引用检查）、AGENTS.md 补引擎集成形态（path 依赖/patch 重复声明/引擎线程边界/hf-hub 共享缓存）、talechime CHANGELOG Unreleased 段
- [x] 4.4 质量门全绿：castglean（cargo fmt/clippy 0/test 14/specta 导出、pnpm build、biome——仅剩 ui/sidebar.tsx 既有 cookie 告警非本变更引入）；talechime（fmt/clippy 0 默认与全特性/测试 56+2 与 facade 63/rustdoc 0）
