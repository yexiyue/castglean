# 工程组织与技术约定

更新：2026-11-07。仓库已在 Tauri 2 脚手架上重启；重启前三 crate workspace 的组织与依赖记录见 `legacy-main` 分支的本文历史版本及[归档设计文档](archive/design/)。

## 工程组织

单一 Tauri 2 应用，Node 依赖由 pnpm 管理：

| 路径 | 职责 |
| --- | --- |
| `src/` | React 19 + TypeScript 界面，只维护临时界面状态 |
| `src-tauri/` | Rust 宿主 crate `castglean`（tauri 2）；工程持久化与后台任务随产品功能落地 |
| `src-tauri/src/main.rs`、`lib.rs` | 应用入口与 Tauri 装配，随实现按模块拆分 |
| `src-tauri/capabilities/` | Tauri 权限声明 |
| `src-tauri/tauri.conf.json` | 窗口、构建与打包配置，标识符 `com.yexiyue.castglean` |
| `docs/`、`assets/`、`openspec/` | 文档、品牌与 OpenSpec 变更管理 |
| `src/lib/bindings.ts` | tauri-specta 生成的类型安全命令绑定；`cargo test --test specta_export` 刷新，勿手改 |
| `src/routes/`、`src/routeTree.gen.ts` | TanStack Router 文件式路由；路由树由 vite 插件生成并随仓库提交，不入 Biome 格式化 |
| `src/locales/`、`lingui.config.ts` | Lingui 文案 catalog（源语言 zh，目标 en）；`pnpm i18n:extract` 提取 |

界面不直接改写权威工程文件，不重复实现核心校验；权威状态在 Rust 宿主，前后端通过显式命令与快照通信。浏览器仅保留示例预览，不实现真实工程的第二套校验、正文缓存或导出路径。分层边界与流畅性约束见[技术选型](desktop-studio/technology-choice.md)。

## Rust 目录与模块约定

### 本地数据库与 AI 模块边界

`refactor-local-ai-task-runtime` 采用 SeaORM 实体优先建模：`database/entity/*.rs` 每实体一个文件，`database/schema.rs` 负责新库初始化与结构版本检查。实体表达列、关系和索引，不直接作为 Specta IPC DTO，也不在 ActiveModel hook 中隐藏模型调用或业务采用。SQLite 与 Apalis 共用 SQLx 0.9 连接基础；队列表由 Apalis 自己初始化，应用实体注册不接管队列表。

事务由实际用例拥有，关联修改必须使用同一连接/事务；内部查询函数复用 SeaORM `ConnectionTrait`，不增加通用 repository 基类或为每张表定义 trait。正文范围和人工覆盖等纯校验不依赖 ORM、Tauri 或 WorkerContext。`ai` 拥有通用消息与执行语义，`jobs` 只拥有队列适配与调度，分章工具仍由 `novel_import` 拥有。模块继续使用具名 `.rs` 门面，不照搬官方示例的独立 entity/api/migration workspace。

设计采用 KISS、DRY、YAGNI 与 SOLID 的职责/依赖边界：共享真实重复能力，接口只围绕实际替换点建立，不为预期业务创建层层空壳。详细职责与实施状态以 [设计](../openspec/changes/archive/2026-11-08-refactor-local-ai-task-runtime/design.md) 和 [任务](../openspec/changes/archive/2026-11-08-refactor-local-ai-task-runtime/tasks.md) 为准；主界面已接本地工程及共享 AI 协议，真实桌面验收仍须独立验证。

通用 AI 用例目前由 `ai/service.rs` 直接拥有跨表事务，`ai/history.rs` 做有界分页读取，`ai/commands.rs` 仅处理 IPC 与当前模型绑定。接受发送时，用户消息和 queued run 同时提交，重复 request_id 比较请求摘要；重试新建 run，不覆盖旧记录。SQLite 写用例先取得写锁再读判定状态，避免读快照升级写事务时的竞争；不把短事务扩展到模型请求或文件解码。消息工具 JSON 在绑定中使用 `unknown`，业务结果引用有独立类型，不为通用 JSON 放宽全局 BigInt 检查。相关行为以[会话测试](../src-tauri/src/ai/service/tests.rs)为证据；Worker 已接入共享执行；前端通过共享 transport 和 use-ai-session 接入。

`ai/runs.rs` 拥有执行租约和事务写入边界：`claim` 条件领取，`Lease` 的身份字段私有，后续消息、计数和检查点先在同一事务校验 owner/generation。领域用例可在此事务内同时提交候选，基础模块不反向依赖分章类型。`ai/budget.rs` 只执行确定性计数规则，`ai/projection.rs` 只把合法消息事实投影到模型历史；不增加模型审计表或复制工具输出。`jobs.rs` 负责宿主所有者锁及启动恢复，`jobs/runtime.rs` 负责准入、可恢复派发和薄 Worker handler。WorkerBuilder 在 spawn 前构造，运行在宿主 runtime；队列 payload 仅含 run_id，不把模型对象、正文或候选塞进队列。模型调用与工具扫描不占数据库写事务，handler 不自动重试已开始的执行。`novel_import/splitting/graph.rs` 保存版本化 graph-flow 检查点：候选与工具完成位置共同提交，图保存通过独立 version 校验并保留工具位置，等待审阅后结束 Worker。恢复 validate 节点不重跑模型，显式继续 review 则创建新 run 和新一轮诊断。

跨表用例由最外层事务发布一次会话 cursor，不能由消息、预算、检查点 helper 各自递增，避免一次业务提交产生不存在的回放序号。执行写入通过 `ai/runs::commit` 统一发布 cursor；`ai/tools.rs` 只保存一次工具事实，通用完成回调不得覆盖领域已提交的结果引用。`novel_import/partition.rs` 是人工编辑与模型建议共用的纯目录计算，`novel_import/splitting` 拥有候选校验和事务；`project/store::prepare` 在事务外完成来源验证和撤销元数据编码，`write` 可加入候选/回执事务。撤销序列化直接构造来源引用，不先复制全文再删除字段。具体故障回归见[候选事务测试](../src-tauri/src/novel_import/splitting/store/tests.rs)。

`ai/stream.rs` 只维护有界交付缓冲和订阅：提交包按 cursor 排序，消息按版本投影，文本追加显式使用 UTF-16 offset。执行租约在提交后通知 Hub，通知失败不能回滚已提交业务；缺口要求 resync，慢消费者由确认窗口隔离。Channel 的发送泵不持有执行事务或调度许可。`src/lib/ai/stream.ts`、`transport.ts` 与 `use-ai-session` 是可丢弃投影，恢复、取消阅读和重连不得重新启动模型；首次发送才创建空会话，StrictMode 清理只解除订阅。界面主链已使用这一实现；原分章专用 transport 和 DTO 已移除。

人工保护绑定源区间和字段。部分替换必须计算保护区间差集，保留两侧未替换部分；不能用“有相交就删除整条记录”代替范围更新。来源范围变化时，旧标注只作历史，不与新范围直接差异合并，重新发布需要显式审阅完整新范围。

依赖来源的 AI 执行必须在首个模型请求前核验受控正文，不能仅比较数据库中的摘要；检查点恢复也经过同一入口。磁盘读取放在 blocking pool 且不持有写事务，读取后按当前执行租约复核工程修订，避免跳过 prepare 或读取期间的人工改动绕过校验。

本地工程查询与 IPC 分开：`project/query.rs` 聚合列表计数并构造无全文的快照，`project/local.rs` 只装配宿主资源和命令；信息、规则、人工边界/卷修改走 `project/edits.rs` 的短事务与回执。`novel_import/selection.rs` 冻结有界原始字节，`novel_import/confirm.rs` 负责确认后的发布与导入事务。`project/text.rs` 只读取数据库归属和 hash 指向的单个来源，不为翻页加载整份工程或撤销正文；纯分页逻辑也供模型工具复用。

数据库初始化失败必须停在启动边界，不能展示空工程或启动 Worker。`lib.rs` 在失败时先调用 `desktop_window::database_unavailable` 隐藏主窗并显示可操作的原生提示；没有数据库状态时统一拒绝应用 IPC，避免隐藏 WebView 的迟到命令访问未初始化的 engine/数据库。关闭提示只确认退出，不重置、导入或删除数据。

Windows 集成测试需要自己的 Common Controls v6 manifest：应用目标收到的 Tauri manifest 不会自动作用于测试目标。`build.rs` 只给 Windows tests 嵌入 `windows-test.manifest`，使链接文件对话框的导出测试可解析 `TaskDialogIndirect`。具体诊断与验证见[Windows 记录](knowledge/lessons/local-storage-windows-validation.md)。

采用 Rust 官方推荐的新项目模块文件布局：`document.rs` 表示模块入口；出现实际子模块后，再增加 `document/normalize.rs` 等文件，由 `document.rs` 声明。避免仅为一个模块入口创建目录；本项目统一使用具名文件而非 `mod.rs`，便于编辑器定位。[模块文件指南](https://doc.rust-lang.org/stable/book/ch07-05-separating-modules-into-different-files.html)

模块默认私有，仅为跨模块访问使用 `pub(crate)`，面向使用方的类型和函数通过 `lib.rs` 的 `pub use` 导出。有意提供模块命名空间时才用 `pub mod`，避免把内部文件布局提前变成公开 API。

领域类型实现时，为角色 ID、章节 ID 等不同概念考虑 newtype；正文范围、已校验结果等具有不变量的类型使用私有字段与校验构造函数。JSON 输入 DTO 与已验证领域对象按需要分离，反序列化成功不能直接代表业务校验成功。[类型安全](https://rust-lang.github.io/api-guidelines/type-safety.html)

模块按领域职责组织；小型 DTO 集合可集中定义，类型自己的构造、转换与校验和类型放在一起。不要因为文件名为 `types.rs` 就强制分离行为，也不要将无关流程和工具函数塞入其中。模块门面使用显式重导出，公开内容按实际调用需要选择；IPC 类型按命令可达关系导出，不依赖 DTO 的文件位置。共享记录时间由 `timestamp.rs` 提供 Unix 秒字符串，不归属于某个模型服务。

测试按作用域放置：模块内部单元测试用 `#[cfg(test)] mod tests`；跨公开 API 的集成测试放在 `tests/`。测试正文使用允许公开分发的短样例，不把私人小说放入 fixtures。

## 前端约定

路由用 TanStack Router 文件式路由（`src/routes/`，`autoCodeSplitting`，路由实例在 `main.tsx` 注册类型）。规划的顶层路由：`/` 工程列表、`/project/:id` 主工作台（角色/演绎/音频三视图内部切换）、`/voices` 音色中心（独立界面）、`/settings` 设置；播放器为全局常驻组件。样式统一 Tailwind CSS v4 工具类，类序与冲突由 Biome 的 Tailwind 规则约束。UI 采用 shadcn/ui 源码组件与 Base UI 原语：组件生成到 `src/components/ui/`，界面语义 token 定义在 `src/index.css`；组件与状态的视觉验收在真实页面进行，不维护独立展示页。状态方案仍随首个真实原型确定。

## 本地开发

```bash
pnpm install                # 安装前端依赖
pnpm tauri dev              # 桌面应用开发模式
pnpm build                  # 前端类型检查与构建（TypeScript 7）
pnpm lint                   # Biome lint（含 Tailwind 类规则）
pnpm format                 # Biome 格式化写入
pnpm i18n:extract           # 提取/更新 Lingui 文案 catalog
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test                  # 含 specta_export，刷新 src/lib/bindings.ts
```

## 依赖选择

类型安全 IPC 由 tauri-specta 提供（`tauri-specta =2.0.0-rc.26`、`specta =2.0.0-rc.26`、`specta-typescript =0.0.13`，三者必须同源配套，见 `src-tauri/Cargo.toml` 注释）；错误处理用 Throw 模式，前端经 `src/lib/bindings.ts` 调用命令。国际化用 Lingui 6（`.po` 格式，源语言 zh）。路由用 TanStack Router（v1，vite 插件 `@tanstack/router-plugin`）。样式用 Tailwind CSS v4（`@tailwindcss/vite` 插件，`src/index.css` 引入）；界面组件采用 shadcn/ui `base-nova` 源码组件与 `@base-ui/react` 原语，基础图标为 `lucide-react`，具体组件随工作流添加。

前端 lint 与格式化用 **Biome**（`biome.json`），不用 ESLint：项目明确不引入 ESLint，而 Tailwind 类排序、冲突类合并与 v4 遗留类检测这三条规则 Biome 2.6 内置（`nursery` 组，oxlint 无对应规则）。Biome 作用域只覆盖 `src/` 与根配置文件，docs、openspec、`.agents` 与自动生成的 `bindings.ts` 不在格式化范围。其余为 Tauri 脚手架依赖（`tauri`、`tauri-plugin-opener`、`serde`、`serde_json` 及 React/Vite 前端工具链）。模型接入使用 Rig 与宿主 Tokio 运行时，持久化使用 SeaORM/SQLite，调度使用 Apalis；额外依赖按实际工作流引入；重启前的选择与验证记录见归档文档。

## 音色搬运的模块边界

`src-tauri/src/voices.rs` 是独立于模型资源的音色域，私有 `library` 负责应用路径与基础库投影，`commands` 管系统选择器与 IPC 装配，`transfers` 管受控文件会话、单活动后台任务、取消与结果快照，`events` 定义应用语义 DTO。文件任务复用宿主运行时的 blocking 资源，不把 Registry/Rc 发进线程池，也不占用引擎 LocalSet。

TaleChime 的资产、私有存储事务、包编解码和传输编排分别变化；公开 `VoiceLibrary` 不要求模型注册表。已校验预览和提交计划字段私有，资产只读，来源使用结构化包索引与音色身份；宿主不解析 ZIP 或匹配错误字符串。IPC 仅导出应用类型、受控会话 ID、名称、度量、错误码和结果，不传录音字节或基础库内部路径。

前端 `use-voice-library` 查询真实资产；`use-voice-transfers` 先订阅再查询，用任务 ID/序号合并事件与快照，关闭结果后拒绝迟到快照重新插入。列表只持有搜索、多选及对话框草稿。预置示例详情和真实资产详情分开，真实资产不能使用示例重命名/移除覆盖。

这些边界对应抽象、封装、模块化、信息隐藏；不引入通用仓储 trait、额外 runtime 或整批跨目录事务。`bindings.ts` 只由测试导出；包括 debug 包在内的应用启动不写源码目录，不依赖开发工作目录。

## 平台窗口与标题栏

`DesktopShell` 保留工程标签与空白拖动区，右侧不再重复显示产品名。`window-controls.tsx` 只渲染 Windows 右侧最小化、最大化/还原、关闭按钮；macOS 保留左侧原生交通灯，Linux 继续使用系统窗口装饰。`use-desktop-window` 从宿主读取平台，从 Tauri 查询并订阅聚焦、大小、DPI 与全屏状态；浏览器不显示虚假的窗口按钮。

`tauri.macos.conf.json` 使用 Overlay、隐藏原生标题、保留 decorations 和交通灯位置；Windows 配置关闭 decorations。平台配置的 windows 数组会替换基础数组，必须保留完整窗口尺寸、最小尺寸、标题和 label，不能只写增量字段。主窗口保持 1360×900、最小 1024×680。

Windows 原生最大化命中测试由 MIT 许可的 `tauri-plugin-snap-layout =1.0.9` 负责，目标为 React 按钮 `window-maximize`。插件不绘制 header，也不要求 `withGlobalTauri`。其两个命令仅在 Windows 的 main 窗口能力中授权。窗口操作只新增 minimize、toggle-maximize、close、start-dragging 四项权限；不授予前端 destroy、exit、任意窗口创建或系统辅助功能权限。

`desktop_window.rs` 集中管理原生关闭与退出边界，`window-close-guard.tsx` 展示会话中未提交的新建信息和宿主当前模型下载/音色任务提示；确认后只能由宿主解除关闭拦截。macOS 预定义 Quit 直接执行 AppKit terminate:，因此默认菜单中的退出项替换为保留系统标题与 Cmd+Q 的受控菜单项。原生交通灯、Cmd+W、菜单退出和自绘关闭按钮共用相同确认，不绕过它强制销毁。工程标签关闭仍只关闭标签。

验证与平台限制见[标题栏验收记录](desktop-studio/window-header-validation.md)。

## 模型进度 Channel

模型资源订阅使用生成绑定 `subscribeModelResources(Channel<ModelResourceMessage>)`，不再广播 `model-resource-event`。Channel 首条消息为盘点快照，后续为带宿主任务 ID 和递增序号的更新。订阅在同一流锁内叠加盘点期间的并发更新、发送快照并登记；旧终态不遮盖后续磁盘盘点，旧任务或终态后的迟到更新不生效。页面离开显式取消订阅，WebView 重载回收其旧订阅；下载生命周期仍由引擎线程持有，订阅释放不取消下载。

TaleChime 下载回调通过 watch 槽保留最新文件进度，转发 future 与下载 future 同属一次 ensure，结束前补发最新值。宿主 `engine/progress.rs` 持续排空有界队列，按文件保留高水位，约每 100ms 发送最新聚合；EOF 立即补发，随后成功/失败终态立即进入 Channel。没有新下载字节时不伪造进度。前端使用浮点百分比，不等待整整 1% 才移动。

`openModelCache()` 由宿主读取当前生效的缓存配置、必要时创建目录，并调用 OpenerExt 的 open_path 在系统文件管理器中打开目录。前端没有路径参数，不新增任意路径打开权限。设置页和下载确认中的打开按钮复用同一组件。此操作只打开缓存目录，不更改位置或搬迁权重。

模型下载采用 TaleChime 默认 Auto：支持时优先 Xet，服务不支持或网络失败时回退 HTTP；两者共用有效范围断点、HF 缓存和最终校验。Xet 乱序块按真实偏移写入，不能把稀疏文件长度或压缩网络字节当作完成进度。源初始化/在途片段有界等待，全局排队和最终校验不按文件无增长判失败。宿主速率估算仍基于确认的文件字节，通过 Channel 输出；验证见[下载任务设计](desktop-studio/download-task-design.md)。hf-hub 由 TaleChime 固定 Git revision 消费，来源和 SDK 发布限制见其 `docs/knowledge/hf-hub-fork.md`。

暂停/继续、任务持久化与分片传输的职责和验收见[下载任务设计](desktop-studio/download-task-design.md)。宿主任务记录不得保存传输凭据或签名地址；暂停确认须等待传输 future 退出并检查断点保存结果。

## 音色创建与试听

`voices/studio.rs` 装配音色生产域；`types` 只定义应用语义，`tasks` 拥有有界任务、请求幂等键、全局序号及取消事实，`store` 拥有已校验候选和媒体租约，`execution` 仅在既有 engine 线程内装配推理，`preparation` 复用引擎下载日志与进度聚合，`commands` 负责原生选择器与薄 IPC，`media` 仅解析已发放音频身份并处理 Range。不引入通用仓储、额外 runtime 或兼容层。

TaleChime 的 `VoiceCandidate` 私有持有校验后的资产与参考音频，构造不写库；设计与录音复用它。`save_candidate` 提交，`install_candidate` 仅适配模型缓存，`Engine::load` 不调用下载准备。前端不能伪造已校验候选，也不能传入任意音频文件路径。`use-voice-studio` 先订阅再读快照，按宿主序号合并；任务结果关闭和候选释放分别处理。常驻播放器控制唯一音源，保留准确转写，停止后释放租约。

当前候选最多 8 个、单条 25 MiB、候选音频总量 200 MiB，短合成最多 500 字（取引擎更小限制）、30 秒/16 MiB PCM；任务最多一个执行加四个等待，最多保留 32 条记录。达到上限要求用户显式释放，不自动丢弃满意候选。未保存候选不跨重启承诺；正式资产和模型缓存分别由各自域拥有。

## 音色试听波形

`voices/studio/waveform.rs` 负责受控 WAV 的后台峰值摘要，`voice_audio_waveform` 返回应用 DTO 并在对应媒体上缓存结果，不接收路径。`src/lib/wave-cn.tsx` 是针对 WaveSurfer 8 的小型生命周期适配，`src/components/waves-cn/wave-player.tsx` 参考 waves-cn 的 UI 并适配 Base UI/Lingui；它们是项目拥有的源码，不由 registry 自动覆盖。`src/lib/voice-playback.ts` 集中拥有媒体元素、播放租约和切换请求序号，`VoicePlayerProvider` 只消费会话快照并渲染。停止、切换与卸载共用清理；迟到波形、播放错误及旧清理结果不能恢复旧试听或污染新会话，未确认释放的租约保留以供后续停止重试。`pnpm test:playback` 使用 Node 24 内建测试执行可控异步竞态，不下载模型。

模型资源准备继续由 engine owner 线程编排：`preparation.rs` 定义应用计划 DTO、阶段投影和普通下载确认指纹；`resource_tasks.rs` 管持久化的资源准备日志，`resources.rs` 管 owner 请求、已计算计划及活动任务，`resources/native.rs` 执行确认的 SDK 配方。计划计算/摘要 I/O 在 SDK 跟踪 worker 上，Registry/Rc 始终留在引擎线程；启动时复用已确认计划，SDK 在任何下载前重新核对指纹，避免在 owner 请求循环中等待全量摘要读取。下载源、凭据、缓存或命中情况变化均拒绝旧确认。

`model_preparation_plan` 返回下载量、转换组件、峰值额外空间、缓存位置及不透明指纹，`prepare_model` 接收该指纹。下载、转换、校验、发布与取消中分别投影为应用状态；原始 SDK 类型、URL、令牌和可执行程序不进入绑定。原生准备使用协作取消并等待任务退出，普通下载保留现有断点取消。活动计数覆盖准备阶段，阻止冲突的音色任务、模型加载验证和设置修改。阶段快照与迟到事件过滤使用同一任务身份/序号，日志见 `resource-preparations.json` v1。

## 整书分章与诊断模块

`project/document.rs` 只负责内存工程及来源、UTF-8 范围和完整分区校验，不读取或写入便携文件。`project/{assets,store,edits,query,local,text,receipts}.rs` 分别拥有不可变来源、工程事务、编辑/撤销用例、元数据投影、IPC、正文分页和幂等回执。`novel_import/{selection,encoding,confirm,detection,partition}.rs` 负责冻结输入、严格解码、确认导入、检测与纯目录计算；`novel_import/splitting/{graph,execution,tools,store}.rs` 负责图、诊断执行、受限工具与候选事务。正式采用只有应用命令可执行，模型工具不具有采用权限。旧 `Recovery`、`novel_import/storage.rs`、`diagnostics/` 与 `project/commands.rs` 已删除，不提供旧文件打开/保存或兼容 facade。

共享界面位于 `components/ai-elements/session-{messages,input}.tsx`，只接收 SDK 消息、文案和回调；不导入分章模型或保存命令。`components/projects/split-proposal.tsx` 按宿主 kind/id 查询候选和实时状态，未知类型仅显示摘要，React 按普通文本转义。`lib/local-projects.tsx` 仅保留工程列表摘要和未提交表单，正文和完整目录由工程路由按 id 请求；列表不持有所有工程全文/章节。导入页面离开时释放未确认选择，不删除已提交来源。

`llm/{config,credentials,providers,transport,commands}.rs` 隔离非密钥配置、系统凭据、协议归一化、有界网络和 IPC。模型参数固定在连接租约中；错误不保留远程正文。前端只接应用 DTO，不接 Rig、graph-flow 或系统凭据实现类型。

锁定 graph-flow 0.8.1（关闭默认特性，不使用 PostgreSQL 或 Rig 消息桥）、rig-core/rig-agent/rig-reqwest 0.46.0；本次依赖树检查没有 SQLx/PostgreSQL 和第二个 Rig 主版本，沿用 Tokio 宿主 runtime。图只管理外层检查点，Rig 管理一次诊断里的有界工具循环。AI SDK UI 7 / React 4 使用 Tauri Channel transport，无 HTTP/Node 应用后端。当前验收边界见[分章验证](desktop-studio/chapter-splitting-validation.md)。


## 官方实践在本仓库的落点（2026-11-07）

| 参考 | 本仓库采用方式与边界 |
| --- | --- |
| [SeaORM Entity-first](https://www.sea-ql.org/SeaORM/docs/generate-entity/entity-first/) | `database/entity/*.rs` 定义实体，`database/schema.rs` 显式注册应用实体并创建初始结构；SQLite 不支持事后自动补外键，因此未知版本停止，不以 schema-sync 代替数据升级。查询在 `project/query.rs`、事务在实际用例中，不复制 Axum server 或独立 migration workspace。 |
| [Apalis handler / Data / Worker](https://github.com/apalis-dev/apalis/blob/main/apalis/README.md) | `RunJob` 仅带 run_id，`jobs/runtime.rs` 用普通 async handler 和 `Data<Arc<Runtime>>` 注入依赖，集中构造 WorkerBuilder，复用 Tauri runtime。应用执行状态由 CAS/owner/generation 保护；队列 ack 不证明业务成功，已开始的模型执行不应用自动整轮重试。锁定 1.0.0 源码和真实 SQLite Worker 测试为版本证据。 |
| [AI SDK Transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport) | `lib/ai/transport.ts` 实现 `sendMessages` 与只读 `reconnectToStream`，把 Tauri Channel 转为 SDK chunks；`use-ai-session` 管分页与订阅寿命。根据本地 `ai` 7.0.163 源码设置 replay 语义，并以真实 SDK Chat 测试验证稳定助手 id、reset-step 和 retry；不引入 HTTP/Redis/Node 产品后端。 |

这三项分别复用框架提供的实体、队列和前端传输扩展点，没有为每张表增加 repository trait，也没有复制一套分章专用 AI 历史。当前版本的行为仍由事务、恢复、协议和桌面验收测试证明，不能只凭示例结构判断完成。
