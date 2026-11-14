# 工程组织与技术约定

更新：2026-11-09。只描述当前Tauri宿主、前端和正式评测的组织。

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

设计采用 KISS、DRY、YAGNI 与 SOLID 的职责/依赖边界：共享真实重复能力，接口只围绕实际替换点建立，不为预期业务创建层层空壳。详细职责与实施状态以 [设计](../openspec/specs/background-ai-execution/spec.md) 和 [任务](../openspec/specs/background-ai-execution/spec.md) 为准；主界面已接本地工程及共享 AI 协议，真实桌面验收仍须独立验证。

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

渲染后的 Markdown 使用项目持有的 `src/typeset.css`，通过 `typeset-chat` 或 `typeset-docs` 命名预设控制排版；需调整节奏时先修改预设。Streamdown 保留链接安全、表格和代码块实现，工具卡在排版容器外；嵌入的组件使用 `not-typeset` 或 `data-not-typeset` 退出。小说原文不是 Markdown，不使用该排版层，原有空白、选择和 UTF-8 坐标验证必须继续通过。

表单使用局部 React Hook Form、Zod 和共享 `Field` 组件，不建立全应用的表单上下文。字段用 `FieldLabel` 与实际控件关联，说明和错误分别使用稳定 ID 并通过 `aria-describedby` 指向，错误时设置 `aria-invalid`；提交失败定位第一个可编辑的无效字段。校验规则保留结构化含义，面向用户的错误由 Lingui 在渲染时翻译，不把内部错误码或 Zod 默认英文直接展示。即时编辑、显式提交和消息输入分别按实际交互接线，不能把选择资源当成提交。

草稿由对应工程或桌面会话按稳定目标身份持有，临时弹层卸载或切换目标不能误清其他草稿；明确撤销和已确认的保存才清理相应输入。异步修改冻结目标、修订和操作身份，回执未知与保存成功后回读失败分开处理。凭据使用保持、替换、移除三态：现有密钥不回显，替换值只留在当前编辑会话和明确提交的宿主请求中，不写入持久草稿、日志或测试产物；关闭会话及进程恢复边界必须向用户说明。

`useWorkspaceState` 的更新先同步写入会话工作区，再通知当前视图，确保同一事件中更新并卸载时草稿不依赖 React 是否执行待处理的状态更新器。函数式更新连续执行时基于工作区中的最新值；同一组件更换工程或键时读取新作用域，旧回调仍写入原作用域。该 hook 不提供跨组件实时订阅，工作区仍只属于当前进程会话。

下载源凭据保存在本机应用配置文件中，不属于系统凭据库；读取设置只返回凭据是否存在。存储设置由引擎线程串行处理，进程内以随机盐摘要核对请求身份并缓存成功和失败结果；回执不跨进程保存，失败可能发生在原子替换后，重新读取也不能证明凭据内容。用户可重试原请求，或先读取当前设置再明确停止核对并继续编辑。

引擎设置快照携带进程内不透明版本，读取、版本比较和写入都经引擎线程串行处理；每次可能触及持久化的尝试都使旧版本失效，即使返回错误。过期草稿被拒绝并保留输入；进程重启后版本与回执重新生成，不支持跨进程重放或多进程同时写同一配置文件。

Biome 使用 `src/index.css` 识别 Tailwind 主题；`pnpm lint` 对原始色板和动态拼接的类名启用 error。颜色使用语义 token；根据状态选择完整类名并通过 `cn` 组合，不拼接类名片段。任意值规则在项目检查范围设为 error；视口约束、滚动行为、锚点计算、组件内部网格和折叠动画等确需的值按文件和完整类名登记在 `biome.json`，新增例外须说明用途并验证边界。组件外观覆盖规则默认设为 error，业务调用和新增文件均受检查；必要布局按文件、组件和具体类名登记例外。共享原语定义层按具体部件和完整类名登记自身样式；旧独立工作台及其整文件例外已移除。`pnpm lint` 另运行基于 JSX 语法树的窄检查：禁止原始 black/white 颜色工具类、常见任意视觉值工具类以及 style 对象中的常见视觉属性、无法静态检查的 style 引用和展开；动态坐标、宽高与虚拟几何仍可使用显式对象。共享侧栏原语的 `...style` 转发是唯一登记的例外，调用方仍须遵循语义 token。 边界编辑器的只读原文 `Textarea` 在该文件中单独允许 `leading-7`，用于定位拆分光标；其他外观类仍由规则拒绝。试听表单的响应式双字段布局使用 `FieldGroup` 的 `responsive-pair` 接口。 Base UI 的 Checkbox 和 Radio 禁用根元素可能是带 `data-disabled` 的非原生元素；禁用视觉状态须覆盖该属性，不能只依赖 `:disabled`。 模型标识使用 `ModelLogo` 的 `sm`、`default`、`lg` 尺寸，不在调用处覆盖内部 padding；其定义层仅允许回退 CPU 图标使用指定的语义文字色和小尺寸内边距。遮罩使用 `scrim` token。CSS 颜色声明另经语法树检查：只有 `src/index.css` 的 `:root` / `.dark` 自定义属性可定义固定颜色，其他位置使用语义变量；图片 URL 和透明色不受影响。该检查分析 JSX 中直接展开的静态对象、无歧义局部初值和嵌套展开；无法静态分析的展开默认报错，既有共享原语转发及表单字段通过 `scripts/visual-prop-spreads.json` 按文件、表达式和数量登记。赋值、成员赋值及 Object.assign 会使对象初值失去静态可信性；同一登记表达式的替换以及其他可能的间接修改仍不能完全证明安全，例外应持续收敛。`pnpm test:tailwind` 验证内建规则、窄检查的正反例与非零退出码，不能把当前检查通过描述为完整样式门禁。

模型和音色设计资源列表共用 `resource-card-columns`，各自的表头与行分别共用 `resource-model-columns`、`resource-design-columns`；窄屏双列使用 `resource-compact-columns`。这两个调用文件启用任意值与组件覆盖 error；详情弹窗使用 `DialogContent` 的 `padding="none"` 接口；标题截断、进度文字与图标的次级样式，以及模型卡片管理按钮的次级文字色，按文件、组件和类名登记，不构成通用组件例外。

需要内部滚动区域的弹窗使用 `DialogContent` 的 `scrollable="standard"` 或 `scrollable="large"`，由共享原语统一高度与列布局；页面不得重新指定相同高度。分章方案的等宽对比使用标准双列布局。

Switch 的标准高度和选中滑块位移在主题与共享原语中定义；调用方通过 `size` 选择，不在页面重复计算控件尺寸。

设置分类与资源侧栏的导航行共用 Button 的 `row` 尺寸；导航目的地使用真实链接并通过 `buttonVariants` 复用样式，保留链接的键盘行为和当前页语义。侧栏品牌链接及状态图标的必要视觉差异按组件和类名登记，不作为整目录例外。

嵌入列表末尾的空状态使用 `AppState placement="list"`，由组件统一间距和分隔线；资源详情中的长名称允许换行，避免依靠截断区分资源。

需要容纳多行内容的按钮使用 `multiline` 变体，保留所选尺寸的字号与水平间距，并统一纵向间距和换行行为。

目录等仅显示图标的标签页使用 `TabsList` 和 `TabsTrigger` 的 `icon` 尺寸，统一行高、间距和点击区域。

工具栏中空间受限的原生选择器使用 `NativeSelect density="compact"`；调用方只负责宽度与排列，不重写字号和内边距。

真实 `<table>` 列表用共享 `ui/table` 原语：`TableHead`/`TableCell` 以 `width`/`tone`/`truncate`/`numeric` 变体提供视觉策略，调用方不传视觉 className；粘性表头由 `TableHeader sticky` 配合使用方的内部滚动容器提供。整行可点不用 tr 挂点击事件，而是首格按钮的 `::after` 铺满整行（stretched 覆盖层），行内交互控件（如勾选框）所在格用 `overlap` 变体浮在覆盖层之上，因此无需拦截事件冒泡。分页状态用「渲染期比较 resetKey/行数并重置页码」的派生模式，不写重置副作用。

页面需要固定页头、内容区占满剩余高度并内部滚动时使用 `PageShell fill`；页头以下的滚动由页面内容自己管理，不依赖整页滚动。

视觉边界检查拒绝工作台不使用的大字号 `text-2xl` 至 `text-9xl` 和大圆角 `rounded-2xl` 至 `rounded-4xl`，以及内联自定义变量；仅侧栏宽度和骨架宽度这三种已使用的几何变量例外。这个规则不覆盖所有可能的命名尺度或已登记转发内部的所有行为，不能视为完整的样式分析器。

## 本地开发

```bash
pnpm install                # 安装前端依赖
pnpm tauri dev              # 桌面应用开发模式
pnpm build                  # 前端类型检查与构建（TypeScript 7）
pnpm lint                   # Biome lint 与视觉边界检查
pnpm test                   # Vitest 前端单元及组件逻辑测试
pnpm exec playwright install chromium # 首次安装浏览器
pnpm test:browser           # Playwright Test；自动启动隔离夹具服务器
pnpm test:tailwind          # Tailwind 与视觉边界正反例
pnpm format                 # Biome 格式化写入
pnpm i18n:extract           # 提取/更新 Lingui 文案 catalog
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test                  # 含 specta_export，刷新 src/lib/bindings.ts
```

前端测试按用途分层：`tests/unit/` 由 Vitest 运行，`e2e/` 按章节、助手、音色、设置、工作区和共享控件分组，由 Playwright Test 运行；`tests/helpers/` 提供合成数据和夹具，`tests/native/` 放需要已连接 Tauri 桌面宿主的检查。`pnpm test:browser` 自动启动夹具服务，默认使用 Playwright 安装的 Chromium，也支持 `BROWSER_EXECUTABLE`。浏览器测试使用合成宿主，不能代替真实 Tauri 原生验收；覆盖迁移记录见 `openspec/changes/migrate-frontend-tests/design.md`。

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

模型资源订阅使用生成绑定 `subscribeModelResources(Channel<ModelResourceMessage>)`，不再广播 `model-resource-event`。Channel 首条消息为盘点快照，后续为带宿主任务 ID 和递增序号的更新。订阅在同一流锁内叠加盘点期间的并发更新、发送快照并登记；旧终态不遮盖后续磁盘盘点，旧任务或终态后的迟到更新不生效。前端按应用共享一个订阅与快照，页面离开不重复盘点；开发热替换显式取消订阅，WebView 重载由宿主回收其旧订阅，迟到注册同样取消。下载生命周期仍由引擎线程持有，订阅释放不取消下载。

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

`project/document.rs` 只负责内存工程及来源、UTF-8 范围和完整分区校验，不读取或写入便携文件。`project/{assets,store,edits,query,local,text,receipts}.rs` 分别拥有不可变来源、工程事务、编辑/撤销用例、元数据投影、IPC、正文分页和幂等回执。`novel_import/{selection,encoding,confirm,detection,partition}.rs` 负责冻结输入、严格解码、确认导入、检测与纯目录计算；`novel_import/splitting/{graph,store}.rs` 负责分章外层阶段与候选事务，纯目录提案留在分章域；`ai/{tasks,assistant,agent}.rs` 分别负责宿主专业任务派发、统一交互/分章子Agent上下文和公共Rig执行，工程工具位于`ai/assistant/tools`。正式采用只有应用命令可执行，模型工具不具有采用权限。旧 `Recovery`、`novel_import/storage.rs`、`diagnostics/` 与 `project/commands.rs` 已删除，不提供旧文件打开/保存或兼容 facade。

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

## 章节分析的职责边界

只维护正式Rig Agent驱动的章节归属分析，不保留退役实现或为了历史实验新增兼容分流。`chapter_analysis/agent_core`只拥有草稿、源范围、身份和纯校验；`agent_runtime`拥有章节归属分析领域hook及脱敏事件，模型执行复用`ai/agent`；`execution`负责冻结输入校验与派发，`execution_agent`负责阶段检查点和领域转换；`publication`拥有一次结果发布事务；`observation`只做进度、只读预审和诊断投影；`query`只做工程标注查询。模型调用不持有SQLite写事务，工具不拥有采用权限。

抽象、封装、模块化和信息隐藏落在这些实际职责上；同时以KISS/YAGNI/DRY/SOLID检查是否有重复逻辑、无用抽象或跨层依赖，不为了形式增加trait、facade或框架。评测复用正式代码且只在测试目标编译；删除专用脚本时同步删除对应测试与过期导航，但保留可复用公开用例及当前机制。兼容性取消不等于删除用户数据或重写Git提交。

## 类型化JSON与现有库能力

固定业务结构使用Serde DTO，开放JSON仅留在外部协议、扩展上下文和确实异构的反馈边界。工具参数从同一类型解码并通过Schemars/Rig `args_schema`生成Schema；不要手写第二份字段表。运行时身份枚举与跨字段条件可追加，但宿主业务校验仍是权威。注意Rig会将Option变为可省略而非nullable，业务需要显式null的字段必须单独核对；缺失、null和空数组不得无意合并。

参数解码拒绝也是一次真实工具尝试，必须进入同一脱敏audit、失败计数和有限修复路径。不能让typed Tool在进入业务前拒绝参数，从而把后续修正统计为首次成功或绕过调用限额。类型化参数成功后直接交给命令执行，不重复序列化再解析。

SeaORM JSON列适用 `FromJsonQueryResult`，固定查询投影使用 `FromQueryResult`；保留必要SQLite JSON聚合，不为追求ORM形式加载全量正文。可覆盖JSON设置/任务日志通过 `atomic_json::save`使用同目录tempfile、写入上限、文件同步和原子替换；锁、版本CAS和凭据发布仍属业务层。原子替换已成功时，目录同步失败不能伪报成未保存；不可变来源继续使用自己的noclobber发布路径。

## 分章Agent的类型与事实边界

章节归属分析与分章的typed Tool共用 `ai/tool_input::Invocation`：保留原始参数与DTO解码Result，先核对已受理调用，再处理解码拒绝；不要在解码时抛出库错误而绕过预算与失败事实。原始调用身份不能用重新编码、补默认值后的JSON替代。共享输入/错误分类改变时必须纳入相应实现摘要。

`ai/assistant/tools/{arguments,adapter,read}.rs`分别拥有工程工具参数/Schema和命令、Rig装配与权限、无副作用的有界读取投影；分章纯试算、提案与原子发布由分章域负责；只读比较仅计算内容及摘要，最终提交才绑定原始准入参数和候选元数据。工具目录与执行都校验会话/冻结上下文；不能仅靠模型看不到工具防止越权。所有候选仍待人工采用，分章普通会话不照搬章节归属分析专属的32/3防空转约束。

流式和非流式Agent使用 `ai/failure`的同一安全分类；关闭内容遥测，流等待阶段也响应CancellationToken。graph-flow继续拥有外层阶段，不增加重复恢复系统；取消的终态仍由job owner在本地工具退出后发布。

## 工程助手与专业任务

一个工程会话不意味着共享全部模型历史。普通交互使用合法会话投影，显式分章使用`ai/history::task_input`按同会话触发身份筛选任务尝试；不能按时间/ordinal截取而混入其他任务。章节归属分析与预审各用独立草稿与输入。`ai/agent`只统一Rig装配、执行策略、流式输出、取消和响应校验；领域hook拥有请求/工具事实及完成判定，任务系统拥有检查点和发布事务。快捷操作直接由`ai/tasks`派发，不增加固定模型路由/总结回合。供应商call ID只在独立Agent执行内有意义；`ToolDispatch`克隆共享该执行身份，新子Agent必须创建独立身份，不能仅用run加call ID导致父/子或分析/预审碰撞。共享执行和身份桥代码改动必须进入章节归属分析实现摘要和正式评测链路。详见[专业任务决定](knowledge/decisions/professional-ai-tasks.md)。


## 已确认任务的确定性继续

委派受理与领域完成是不同终态。工具已经原子受理明确任务时，宿主直接派发专业任务，不再增加仅复述受理的模型回合；最终候选工具成功后直接交付其权威结果，人工采用仍独立。批量确定性试算只返回有界摘要，不提前发布候选或自动选择。移除旧协议时同步更新Schema、宿主权限、历史重放、UI工具标签和原生协议夹具，不在正式代码保留实验基线路由。

评测计量hook须先于可能停止链路的领域hook观察响应，保留被拒响应已返回的真实usage。全任务总量存在未知时保持未知，同时累计逐请求已知成本，不能把部分失败任务的已知费用归零。对照以预先冻结的程序/实现身份校验响应；输入摘要须独立从冻结正文、请求与规范人工修正计算，不能只相信首组自报。requestCount与逐请求列表须完整一致，缺失计量不得当零或以旧聚合字段回退；缺失身份不得通过可比性门禁。快照编码和原子写盘在既有blocking worker执行，释放状态锁后等待落盘确认。相关回归及真实结果见[任务效率验证](desktop-studio/task-efficiency-validation.md)。

## 跨资源提交与运行配置（2026-11-10）

需要协调数据库引用与文件库删除的用例，在最终检查到资源移除之间与引用发布共用互斥边界。用户确认弹窗不持锁，确认后重新检查引用；SQLite 事务本身不能保护另一存储域的删除。磁盘目录预读放在 blocking worker 且先于写事务，进入事务后仍核对租约、目标与修订。该进程内边界不代替读取时检测外部文件缺失。

按运行的模型参数既要进入任务元数据，也必须进入实际客户端的请求默认值；不能仅在某个专业任务的显式 options 中接线。配置拒绝须经过执行收尾以释放名额。Retry 读取原运行配置，配置解析和请求准入共用同一权威来源；用户发出新消息的 Continue 与恢复原在途调用区分。实例与回归入口见[声音绑定及配置审查](knowledge/decisions/voice-binding-review.md)。

资源 SDK 的“只读”目录 API 也可能申请非等待文件锁。宿主并行消费者应共享读取协调，并在 blocking worker 执行磁盘扫描；不能因只读而假定调用可重入。验证须含真实资产以及多线程读取，空目录冒烟不足以覆盖该竞争。实例见[声音绑定真实验收](desktop-studio/voice-binding-acceptance-2026-11-10.md)。

后台队列消费器必须处理退出结果并有恢复路径；持久 Worker 身份不能跨宿主实例复用，以免有效注册阻塞快速重启。基础设施重建继续受领域领取与提交栅栏约束，不能作为自动重发已开始模型请求的理由。案例见[AI 消费器恢复](knowledge/lessons/ai-consumer-recovery.md)。

## 界面命令回执与草稿

带幂等身份的界面修改应区分提交结果与随后读取结果：收到宿主回执后采用其修订，读取失败不能将成功修改表现为失败。结果未知时保留原操作身份、期望修订及参数重放，不用新身份盲目重建操作；只读旧快照不能覆盖较新修订。需要跨选项保留的失败草稿由工作区拥有，不能绑定到临时详情组件的挂载寿命。证据见[章节直接编辑审查](../openspec/changes/simplify-chapter-workflow/review.md)。

## 真实桌面调试

界面与制作流程验收优先使用 [Tauri MCP 调试桥](desktop-studio/desktop-mcp.md)，直接操作真实 WebView 和宿主。模拟浏览器状态不能代替桌面验收。

## 界面组件选型

新增或重构交互前先检查 `src/components/ui/` 与已安装组件库，优先复用现有 shadcn/Base UI 组件；缺少能力时比较成熟方案并记录许可、维护和平台约束。自定义交互须说明现有组件无法满足的具体需求，并验证键盘、焦点、状态及亮暗主题。复杂布局动效优先评估 Motion，尊重减少动态效果，不能让动画承担业务状态正确性；具体取舍和真实桌面证据见[制作体验设计](desktop-studio/production-experience-design.md)。

## 设计 skill 的职责

UI/UX 设计、审计与打磨以项目内 `impeccable` 为主；`shadcn` 负责已有组件与 Base UI 接法，React、国际化、Tauri 专项 skill 按实现问题配合。产品事实与约束以 `AGENTS.md`、品牌文档和当前源码为准。2026-11-13 清理重复或偏营销素材的 `banner-design`、`brand`、`design`、`design-system`、`slides`、`ui-styling`、`ui-ux-pro-max`；不修改机器全局 skill。Impeccable 的平台二进制由启动器按版本下载，不入库，项目 hook 保留。
