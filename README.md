# CastGlean

面向个人的桌面有声书生成与收听应用：把自己有权使用的小说生成为可听的多角色有声版本，动机是收听而非发布；完整阅读体验由独立项目 TRNovel 承担。围绕小说正文完成分析、检查、选声、生成、试听、修正与导出：模型提出建议，程序负责校验，人保留制作决定权。

当前状态：2026-11-02 仓库在 Tauri 2 脚手架上整体重启；已接入工程文件保存与重新打开（2026-11-02）和 TaleChime 引擎模型资源管理（2026-11-04：真实模型目录、共享 Hugging Face 缓存下载、离线盘点、镜像端点与存储位置配置），制作能力仍在开发。重启前的分析库、schema、示例与 CLI 实现完整保留在 `legacy-main` 分支，仅作参考。

## 技术栈

- 桌面框架：Tauri 2（系统 WebView + Rust 宿主），选型依据见 [docs/desktop-studio/technology-choice.md](docs/desktop-studio/technology-choice.md)
- 前端：React 19 + TypeScript + Vite，TanStack Router 文件路由；UI 采用 shadcn/ui 源码组件与 Base UI 原语，包管理器 pnpm
- Rust 宿主：`src-tauri`，负责工程持久化与后台任务；选角、声音映射、候选与导出随产品功能落地
- 音色试听播放器采用 WaveSurfer.js 8，UI 参考 waves-cn 并适配现有 shadcn/Base UI；宿主后台提取并缓存波形摘要，音频仍通过受控本地协议播放。章节工作台的音频闭环仍待接入。

## 开发

```bash
pnpm install        # 安装前端依赖
pnpm tauri dev      # 桌面应用开发模式
pnpm build          # 前端类型检查与构建
cd src-tauri && cargo check   # 校验 Rust 宿主
```

## 界面预览

开发服务器提供以下可交互的前端设计预览，沿用 `docs/design.pen` 的页面层级：

- `/`：独立工程首页；宽导航提供新建、打开、最近工程和共享音色中心。
- `/new`：工程信息、批量 TXT 导入、只读预览、章节标题和顺序确认。
- `/project/sample`：章节正文、角色/演绎/音频视图、检查面板和播放器布局。
- `/project/preview-*`：当前浏览器会话导入的原文工作台，章节可切换，未分析、无音频状态显式展示。
- `/models`：独立模型中心，展示当前构建实际编译的本地模型与离线盘点状态（未下载/部分就绪/已就绪/下载中/失败），支持准备计划确认、分阶段进度、取消/重试及加载验证；Kokoro 两变体、CosyVoice3 和 IndexTTS 使用已验证固定成品，其他模型沿用共享 HF 缓存下载；模型更新与移除待接入。
- `/voices`：我的音色从 Rust 宿主读取真实资产，支持一次选择多个 `.voice` 包、完整校验、逐项选择与冲突决定、批量导入，以及多个音色导出到一个包；进度和结果可在切页后从任务快照恢复。音色存于应用数据目录 `voices-v2/`，不依赖模型下载或服务连接。预置音色来自实际模型目录，不可作为参考资产导出；真实资产已接重命名、确认删除、原始参考与指定模型试听；播放、推理及传输占用时删除返回忙状态。
- 音色详情按工程分组展示示例角色/旁白引用，可定位到 `/project/sample?section=characters&binding=…` 的对应绑定。角色页支持“选择音色→确认影响→预览更换”和撤销，反向引用同步使用会话覆盖；示例基线不改写。影响数量由宿主计算，当前显示待接入；不自动生成、不修改已有采用结果或工程文件。
- `/voices/new`：文字设计与参考录音两种创建方式分别使用真实设计引擎和用户 WAV；参考录音与准确转写可在不加载模型时保存。支持会话草稿、旧候选保留及常驻试听播放器；现已接入真实设计引擎、WAV 候选、试听和确认入库；候选切页保留，未保存候选不承诺跨重启恢复。
- `/settings/general`（`/settings` 自动跳转）：完整应用设置。models、storage、language、shortcuts、privacy 为独立子路由，可返回原工程。`/settings/models` 仅呈现服务连接配置，模型资源统一在模型中心管理。
- `/design-system`：亮暗主题与组件展示。
- `/design-system#app-states`：统一的空白、无匹配、服务未就绪和错误反馈组件。实际页面覆盖首次使用、搜索/分类为空、角色与制作结果为空、404、路由加载失败、文件操作失败、章节导入问题及录音播放失败；提供清除筛选、重新选择、重试或返回入口。服务未接入不伪装为连接错误。

所有业务页面共用顶部工程标签栏，一个标签对应一本小说的一个制作工程。工程工作区使用固定窄导航，提供章节、工程角色和制作结果入口；示例角色页支持会话内声音绑定预览，导入工程的角色页与制作结果仍展示未接入分析或真实音频的空状态。关闭标签只收起当前视图，会话工程仍在首页；章节、正文视图和阅读位置在会话内分别保留，刷新后不恢复标签或会话。

示例页面使用预览数据；新建和打开的工程使用实际文件内容与临时 UI 快照。新建工程可在浏览器中读取用户选择的 UTF-8 TXT，每文件作为一章，按文件名自然排序，支持去重、移除、标题调整、上下移动和进入原文预览。不上传、不改写原始 TXT。桌面工作台通过系统对话框保存 `.castglean` 工程文件；首页可重新打开并校验格式、版本、章节 ID 与原文 SHA-256。浏览器画布提供同格式导出和文件选择打开，触发下载只标记“已发起导出”。不写浏览器存储，刷新后需重新选择工程文件；未保存的会话不能恢复。每文件上限 5 MB，每工程最多 50 章、合计 20 MB；空白文件、无效编码与不支持的格式显式报错，EPUB 暂未接入。

Rust 宿主已实现工程快照校验、同目录临时文件写入、同步后原子替换；取消选择不改变当前工程，失败不发布半成品。格式见 [工程文件 v1](docs/data-format.md#桌面工程文件-v1)。当前只保存工程信息、章节标题、顺序与精确原文，不含分析、声音映射或音频。系统对话框的桌面端人工验收仍需在 Tauri 应用中完成。音色包批量搬运已接入；音色设计候选、录音创建、合成试听与原始参考播放已接宿主，真实模型与桌面端验收见下文；章节音频制作、后端服务配置和系统通知仍待接入；导入的预览工程不展示伪造的角色建议或音频候选。外观与语言仅在当前预览会话内切换。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/desktop-studio/README.md](docs/desktop-studio/README.md) | 桌面有声书工作台企划 |
| [docs/desktop-studio/execution-and-roadmap.md](docs/desktop-studio/execution-and-roadmap.md) | 执行与路线图 |
| [docs/data-format.md](docs/data-format.md) | 数据格式约定 |
| [docs/brand.md](docs/brand.md) | 品牌规范 |

注意：`docs/` 与 `assets/` 跨重启保留，其中对 `crates/`、CLI 及 schemas/examples 的结构描述属于旧实现，随新实现落地逐步更新。

## 路线图

- [x] 仓库在 Tauri 2 脚手架上重启，品牌与文档迁移完成
- [x] 引擎接入层（B1）：TaleChime path 依赖、hf-hub 共享缓存下载、模型中心真实化
- [ ] 首个原型：正文阅读区、检查面板与播放器同屏运行并验证流畅性
- [ ] 一章制作闭环：分析、检查、选声、生成、候选采用与导出
- [ ] 连续章节与整书批处理

详细规划见 [docs/desktop-studio/execution-and-roadmap.md](docs/desktop-studio/execution-and-roadmap.md)。

桌面窗口已接入平台标题栏：macOS 左侧原生交通灯、Windows 右侧自绘窗口按钮，以及未保存会话/活动任务的统一关闭确认。Windows 原生 Snap 适配已接入，实机行为仍待验收；见[标题栏验收记录](docs/desktop-studio/window-header-validation.md)。

模型下载进度使用有序 Tauri Channel 与重连快照，约 100ms 合并最新字节进度，展示实测速率、剩余时间估算与停滞提示；下载默认优先 Xet，不可用时从有效断点回退 HTTP，支持暂停/继续、重启后的手动恢复、范围并发调度与网络读超时；缓存设置与下载确认可在系统文件管理器中打开当前缓存目录。见[验证记录](docs/desktop-studio/model-progress-validation.md)。

模型下载任务、分片策略与验收边界见[下载任务设计](docs/desktop-studio/download-task-design.md)。

音色中心新增七类语音后端与四类设计适配的真实目录，macOS 编译 CPU＋Metal；编译覆盖不等于各模型实测通过。候选生成、确认入库、原始参考与模型试听的边界及验收见[音色中心验证](docs/desktop-studio/voice-center-validation.md)。

2026-11-05 原生成品准备工作区验证：三类模型及 Kokoro 两变体的 8 个 CPU/Metal 组合均生成有效 WAV，Kokoro 的桌面确认→准备→就绪→波形试听已验证。人工听感、CosyVoice3 旧数值门禁差异与 `complete-voice-center` 剩余验收仍单独保留，见[验收记录](docs/desktop-studio/voice-center-validation.md)。本轮未发布 SDK/应用版本。
