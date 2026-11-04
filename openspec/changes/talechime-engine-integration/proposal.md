# Proposal

## Why

CastGlean 的所有出声功能（选声、试听、合成、导出）都以本地语音引擎就绪为前提，而当前 Rust 宿主（413 行，仅工程文件存取）与 TaleChime 引擎之间零集成；`/models` 模型中心整页是会话内夹具。同时 TaleChime 现有下载层把 `huggingface.co` 硬编码在编译期内嵌清单里，国内网络环境下首次资源准备必然失败。这是路线图 B1（引擎接入层）的立项：打通"引擎进程内集成 + 真实资源准备 + 模型中心真实化"，为后续一章制作闭环（P0）提供唯一入口。

## What Changes

- 宿主以 **path 依赖**接入本地 TaleChime checkout（`../talechime/crates/talechime` facade，进程内共享 tokio 运行时；已否决 submodule 与 JSON Lines worker 形态，接口稳定后切 git 依赖钉远端）。
- **引擎侧（talechime 仓）**：下载层整体替换为 hf-hub 1.0（`HFClient`）——手写 reqwest 下载器退役；resources 清单瘦身为 `repo@commit + filename`（钉 commit 保留以保证可复现性；sha256 字段移除——完整性信任 Hub etag 指名 blob 与传输完整性，`size` 保持必填并统一用于就绪判定与空间预检；本地转换型清单保留 size + SHA-256 校验）；引擎暴露可配置的 `cache_dir` / `endpoint` / `token` 三件套（hf-hub builder 默认值是相对 cwd 的路径且不读环境变量，宿主必须显式传入）；进度经 `ProgressHandler` 桥接为引擎既有 Event 流；新增离线盘点 API（基于 hf-hub 缓存布局：已就绪 / 未下载 / 部分就绪，不发网络请求）。
- **宿主侧（castglean 仓）**：`src-tauri` 增设 `engine` 模块，集中持有引擎生命周期、模型目录、资源任务状态机与事件桥；IPC 层新增模型目录查询、资源准备（下载/校验）、取消、盘点等命令与进度事件；显式可配置的模型缓存目录与下载源（默认官方端点，可切镜像如 hf-mirror.com）。允许对现有 `src-tauri` 模块结构做必要的重构（当前仅 `commands`/`project` 两模块）。
- **前端**：`/models` 模型中心从 `preview-models.ts` 夹具切换为宿主真实状态——本地模型的真实能力、大小、资源状态（未下载 / 下载中 / 部分就绪 / 已就绪 / 失败）、下载前确认（总大小 + 磁盘剩余空间）、进度与取消；移除"示例"免责声明中与真实状态冲突的部分。共享同一真实模型目录数据的消费方（`model-select`、音色中心兼容性筛选）同步接入；音色中心其余夹具不在本变更范围。
- **BREAKING**：`src/lib/preview-models.ts` 的模型目录夹具退役（类型与导出被真实目录数据源替换）；引擎侧 TaleChime 手写下载器与清单 `url` 字段移除（path 依赖随本地 checkout 演进，不走 crates.io 版本协商）。

明确不做（后续块）：音色创建/克隆/试听（B2）、合成执行与候选（B4）、角色分析后端接入（B5）、朗读规划与批量（B8）；模型"加载到设备并保持"不作为本变更的交付状态，资源可用性以冒烟验证（加载成功即释放）为准。

## Capabilities

### New Capabilities

- `model-resources`: 模型资源管理——真实模型目录展示、资源下载与校验、取消与重试、离线状态盘点（含应用重启后）、下载前确认（大小与磁盘空间）、下载源与存储位置配置（镜像端点支持）。这是模型中心的持久行为契约。

### Modified Capabilities

（无——`openspec/specs/` 当前为空，本仓尚无已归档能力。）

## Impact

- **talechime 仓**（path 依赖工作树内直接修改）：`talechime-backends` 的 download/resources 模块重写为 hf-hub；`talechime` facade 新增可配置资源根与盘点 API；新增 `hf-hub` 依赖；CosyVoice3 等本地转换型资源不受影响。
- **castglean 仓**：
  - `src-tauri/`：新增 `engine` 模块（生命周期、目录、资源任务、事件桥）；`lib.rs` 注册新命令与事件；`Cargo.toml` 增加 talechime path 依赖与 feature 裁剪（首批编译进 Kokoro 中文 + MOSS 默认后端，具体以引擎 feature 表为准）。
  - `src/lib/bindings.ts`：tauri-specta 重新导出（新增命令与事件类型）。
  - `src/components/models/`、`src/routes/models.tsx`：夹具 → 真实状态。
  - `src/lib/preview-models.ts`：退役替换；`model-select`、`voice-library`、`voice-detail-sheet`、`change-voice-dialog` 等消费方适配真实目录。
  - `src/components/settings/`：存储位置（模型缓存目录）与下载源（端点/镜像、token）设置项落地。
  - i18n 文案（zh/en）随新状态补齐。
- **构建与依赖**：hf-hub 1.0（reqwest/rustls，与两仓现有栈一致）；无 crates.io 版本协商（path 依赖期间 CI/他机不可构建，已知且接受）。
- **文档**：README 路线图勾选 B1 相关条目；`docs/desktop-studio/interaction-design.md` 模型中心章节由"设计预览"改为"已接入"并保留未完成项（更新/移除的真实执行）；AGENTS.md 补充引擎集成形态说明。
