# Design

## Context

当前 `src-tauri` 仅 `commands`/`project` 两模块（工程文件存取），与 TaleChime 引擎零集成；`/models` 页面消费 `src/lib/preview-models.ts` 会话夹具。TaleChime 本地 checkout（`../talechime`，v0.6.1）已有：模型发现 Registry、adapter 自持资源清单（编译期内嵌 `resources.json`，URL 硬编码 `huggingface.co`）、手写 reqwest 下载器、Event 进度流。集成形态与下载层选型已在探索阶段定案（path 依赖 + hf-hub 1.0 全量接管下载，见 proposal），本文只记 HOW 与架构约束。

用户对本次重构的硬性要求：架构合理简洁、模块划分正确、符合软件设计四大原则（抽象、封装、模块化、信息隐藏），允许大改。

## Goals / Non-Goals

**Goals:**

- 宿主与引擎之间建立唯一、清晰的所有权边界：引擎细节不越过 `engine` 模块。
- `/models` 消费真实目录与真实资源状态，夹具退役。
- 下载源（镜像端点/凭据）与存储位置成为宿主显式配置，不依赖环境变量与运行时工作目录。
- `src-tauri` 模块结构为后续块（音色、合成、任务中心）立好骨架，不再推倒。

**Non-Goals:**

- 合成执行、候选、采用（B4）；音色创建与库管理（B2）；分析后端接入（B5）。
- 模型"加载到设备并常驻"状态；本变更只做下载就绪 + 冒烟验证（加载成功即释放）。
- 单文件断点续传（hf-hub 1.0 不支持；已就绪文件不重下已由缓存布局保证）。
- 已下载资源的迁移与清理工具（存储位置切换不迁移，spec 已定）。

## Decisions

### D1 宿主模块划分（四大原则的落点）

```
src-tauri/src/
  lib.rs            # 组装：注册 engine 状态、命令、事件；不含业务
  project/          # 既有工程文件域（commands + project 拆为目录，行为不变）
  engine/
    mod.rs          # 模块门面：只暴露应用语义类型与操作（抽象边界）
    catalog.rs      # talechime Registry 元数据 -> 应用层 ModelEntry（预置/克隆/设计能力）
    resources.rs    # 资源状态机 + 准备任务 + HFClient 构建（cache_dir/endpoint/token）
    inventory.rs    # 离线盘点：按 hf-hub 缓存布局聚合 Missing/Partial/Ready
    events.rs       # talechime Event / 下载进度 -> Tauri 事件桥
    commands.rs     # IPC 薄封装：参数校验后委托上述模块，自身无逻辑
    config.rs       # 宿主应用配置（下载源、存储位置）持久化，版本化 JSON
  bindings          # tauri-specta 导出 = 前端唯一契约（信息隐藏边界）
```

- **抽象**：IPC 命令签名与 specta 导出只出现应用语义类型（`ModelEntry`、`ResourceState`、`PrepareProgress`、`PrepareError`）；`talechime::*` 与 `hf_hub::*` 类型不出现在任何命令签名（呼应 AGENTS.md「宿主消费 TaleChime，不把后端类型放进分析逻辑」）。
- **封装**：下载细节（镜像、缓存布局、清单格式、重试）全部封在 `engine/resources.rs` + 引擎仓内；配置三件套由 `engine` 持有并构建客户端，其他模块不知晓。
- **模块化**：`project` 与 `engine` 平级、互不依赖；`commands` 各归其域（工程命令留在 `project/`）；跨域通信只经模块入口文件（`engine.rs` / `project.rs`）显式 API。后续 `voices/`、`synthesis/` 按同构方式挂入。
- **信息隐藏**：前端不知道 TaleChime 与 hf-hub 的存在，只见 bindings 类型与事件名；`src/lib/models.ts` 取代 `preview-models.ts` 成为唯一模型目录数据源（`model-select`、音色中心筛选等消费方全部改指向它）。

替代方案：把引擎调用直接写进现有 `commands.rs`（ rejected：IPC 层立即被引擎类型污染，后续每块都复制这种耦合）；或引入 `core/` 中间层（rejected：当前只有一个引擎，为假想抽象加层违反简洁）。

### D2 引擎侧改造（talechime 仓，path 依赖工作树内）

- `talechime-backends`：`download.rs` 手写下载器删除；`resources.rs` 的 `prepare` 改走 hf-hub `HFClient::download_file().revision(commit).filename(...)`，返回缓存路径；进度经 `ProgressHandler` 桥接为既有 `Event::ModelProgress`（事件协议不变，前端零感知）。
- 清单 schema 瘦身：`resources.json` 每条目 `repo + revision(commit) + filename + path?`；`url` 与 `sha256` 删除（远程条目完整性信任 Hub etag 指名 blob 与传输完整性）；`size` 保持必填——就绪判定（存在且大小匹配）与空间预检、进度总量都依赖清单预知，不用先发 HEAD。本地转换型清单保留 size + SHA-256 显式校验。
- `talechime` facade 新增：`ResourcesConfig { cache_dir, endpoint, token }`（显式传入，覆盖 hf-hub builder 默认——其默认是相对 cwd 的 `.cache/huggingface/hub` 且不读环境变量，桌面应用不可依赖）；离线盘点 API（基于 hf-hub 缓存布局逐文件判定，含负缓存）。
- CosyVoice3 等本地转换型资源（清单无远端）不走下载路径，盘点按本地目录存在性判定。

两仓职责边界规则：**应用语义（确认对话、状态机、磁盘预检、UI 文案）在宿主；引擎只提供可验证原语（目录、下载、盘点、能力）**。凡需要在引擎里写"应用想要什么"的代码，就是边界放错了。

### D3 资源状态机与任务模型

```
ResourceState:
  Missing ──准备──> Downloading{per-file+整体进度} ──全部就绪──> Ready
     ^                │取消(已完成文件保留)              │
     │                ├──失败──> Failed{typed reason}     │
  Partial <───────────┘         （重试回到 Downloading）    │
     └────────盘点随时重算（离线，应用重启后即来源）<──────┘
```

- 状态的**权威来源是盘点**（磁盘事实），Downloading/Failed 是叠加在上的任务视图；应用重启后无持久化任务，状态回归盘点结果（对应 spec「重启后状态一致」）。
- 同一模型并发准备任务至多一个（引擎文件锁 + 宿主侧任务表去重）；不同模型可并行，但共享下载带宽，首版串行队列即可（简单优先，实测痛了再加并发）。
- 磁盘可用空间由宿主查询（平台相关属应用职责），预检在发起前完成。

### D4 错误类型化

宿主定义 `PrepareError`（specta 导出为 TS 联合类型）：`network | auth | rate_limited | disk | cancelled | internal`。映射源：hf-hub `HFError`（`AuthRequired/Forbidden/RateLimited` 等已类型化）+ 引擎 anyhow 边界处的显式归类；未识别错误归 `internal` 并保留原始信息于日志（凭据不入日志）。

### D5 配置持久化

`engine/config.rs` 在应用配置目录存版本化 JSON（`{ version, storage: { cacheDir }, download: { endpoint, token? } }`）。默认 `cacheDir` = **共享 Hugging Face 缓存目录**（`$HOME/.cache/huggingface/hub`，与 Python `huggingface_hub` 等生态工具的字节级兼容布局）——选 hf-hub 的核心收益就是缓存复用，默认即生效，不经用户配置；下载的模型权重**只**落此目录，不进引擎自有目录（TaleChime 本地目录仅保留本地转换型资源与音色资产，下载权重不放）。宿主显式解析该绝对路径传入（hf-hub builder 默认是相对 cwd 的路径，不可依赖）。端点默认官方，镜像由用户显式配置。代价：其他工具清理/卸载缓存会移除 blob——盘点以磁盘事实为权威，缺失即回到未下载，可重新下载（见 Risks）。

### D6 前端数据流

- 快照查询命令 `list_models()`（目录 × 盘点 × 当前任务状态合并）+ 每模型状态事件，不轮询。事件与快照共用完整 `ResourceState`，进度由 `Downloading` 承载，不再附加第二套可选进度字段。
- `src/lib/models.ts` + `src/hooks/use-model-resources.ts`（订阅+缓存）；页面局部状态，不引全局 store（单页消费，提前引入违反简洁；B4 任务中心需要全局时再上）。
- `preview-models.ts` 删除；5 个消费组件改接真实目录。音色中心**其余**夹具（音色列表、绑定示例）不动，只换模型目录来源。

### D7 构建裁剪

castglean 编译 talechime feature：`kokoro`（中文预置音色，P0 单人旁白首选验证）+ 默认 MOSS `nano-candle`；macOS 含 Metal 路径，CUDA 不编。模型中心只显示编入的模型（真实原则：目录反映构建事实）。其余后端 feature 在对应块接入时再开。

## Risks / Trade-offs

- [大文件中断全量重下（hf-hub 无单文件续传）] → 已就绪文件不重下把损失限制在单文件内；镜像端点稳定性缓解；跟踪 hf-hub 上游续传支持，届时引擎侧单点替换。
- [path 依赖随本地 checkout 漂移，他机不可构建] → 单人单机已知且接受；切 git 依赖钉 commit 是既定后续；两仓改动在 tasks 中以仓库标签成对出现。
- [编译时间与二进制体积增长] → D7 裁剪只编两后端；release 构建体积在验收时记录基线。
- [talechime 仓改动与本仓验收耦合] → 引擎侧任务自带独立验证（引擎单测 + 冒烟），宿主任务只在引擎任务绿后接入；避免"两边都半绿"。
- [职责边界漂移（应用语义漏进引擎）] → D2 边界规则写入选型；code review 自查点。
- [磁盘预检的竞态（下载中他处占满磁盘）] → hf-hub 写失败会落 `disk` 错误，状态机走 Failed；预检只做前置拦截，不承诺全程无竞态。
- [默认共享缓存目录被其他工具清理/卸载] → 盘点以磁盘事实为权威，blob 缺失如实回到未下载/部分就绪，用户可重新下载；下载只补缺失文件，成本可控。

## Migration Plan

- 无存量数据迁移：设置文件首次生成默认值；模型缓存目录初始为空目录。
- 回滚 = 两仓各自 revert（path 依赖无版本协商，不存在半升级状态）；已下载资源目录与回滚互不影响。

## Open Questions

- 凭据存储是否升级为系统 keychain：本版存用户目录明文 JSON（不入 Git），keychain 作为后续独立增强，不影响本变更结构。
- 镜像默认值是否做首次连通性探测：spec 已定默认官方端点，探测属体验优化，可后补。
- 冒烟验证（模型加载成功即释放）的触发时机（下载完成后自动 vs 手动按钮）：实施时按交互成本定，不改变状态机。
