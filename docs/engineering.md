# 工程组织与技术约定

更新：2026-11-02。仓库已在 Tauri 2 脚手架上重启；重启前三 crate workspace 的组织与依赖记录见 `legacy-main` 分支的本文历史版本及[归档设计文档](archive/design/)。

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

界面不直接改写权威工程文件，不重复实现核心校验；权威状态在 Rust 宿主，前后端通过显式命令与快照通信。分层边界与流畅性约束见[技术选型](desktop-studio/technology-choice.md)。

## Rust 目录与模块约定

采用 Rust 官方推荐的新项目模块文件布局：`document.rs` 表示模块入口；出现实际子模块后，再增加 `document/normalize.rs` 等文件，由 `document.rs` 声明。避免仅为一个模块入口创建目录；本项目统一使用具名文件而非 `mod.rs`，便于编辑器定位。[模块文件指南](https://doc.rust-lang.org/stable/book/ch07-05-separating-modules-into-different-files.html)

模块默认私有，仅为跨模块访问使用 `pub(crate)`，面向使用方的类型和函数通过 `lib.rs` 的 `pub use` 导出。有意提供模块命名空间时才用 `pub mod`，避免把内部文件布局提前变成公开 API。

领域类型实现时，为角色 ID、章节 ID 等不同概念考虑 newtype；正文范围、已校验结果等具有不变量的类型使用私有字段与校验构造函数。JSON 输入 DTO 与已验证领域对象按需要分离，反序列化成功不能直接代表业务校验成功。[类型安全](https://rust-lang.github.io/api-guidelines/type-safety.html)

测试按作用域放置：模块内部单元测试用 `#[cfg(test)] mod tests`；跨公开 API 的集成测试放在 `tests/`。测试正文使用允许公开分发的短样例，不把私人小说放入 fixtures。

## 前端约定

路由用 TanStack Router 文件式路由（`src/routes/`，`autoCodeSplitting`，路由实例在 `main.tsx` 注册类型）。规划的顶层路由：`/` 工程列表、`/project/:id` 主工作台（角色/演绎/音频三视图内部切换）、`/voices` 音色中心（独立界面）、`/settings` 设置；播放器为全局常驻组件。样式统一 Tailwind CSS v4 工具类，类序与冲突由 Biome 的 Tailwind 规则约束。UI 采用 shadcn/ui 源码组件与 Base UI 原语：组件生成到 `src/components/ui/`，界面语义 token 定义在 `src/index.css`，`/design-system` 用于设计验收；状态方案仍随首个真实原型确定。

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

前端 lint 与格式化用 **Biome**（`biome.json`），不用 ESLint：项目明确不引入 ESLint，而 Tailwind 类排序、冲突类合并与 v4 遗留类检测这三条规则 Biome 2.6 内置（`nursery` 组，oxlint 无对应规则）。Biome 作用域只覆盖 `src/` 与根配置文件，docs、openspec、`.agents` 与自动生成的 `bindings.ts` 不在格式化范围。其余为 Tauri 脚手架依赖（`tauri`、`tauri-plugin-opener`、`serde`、`serde_json` 及 React/Vite 前端工具链）。模型接入（genai、Tokio）、持久化格式与测试依赖按实际工作流需要再引入，不提前添加；重启前的选择与验证记录见归档文档。

## 音色搬运的模块边界

`src-tauri/src/voices.rs` 是独立于模型资源的音色域，私有 `library` 负责应用路径与基础库投影，`commands` 管系统选择器与 IPC 装配，`transfers` 管受控文件会话、单活动后台任务、取消与结果快照，`events` 定义应用语义 DTO。文件任务复用宿主运行时的 blocking 资源，不把 Registry/Rc 发进线程池，也不占用引擎 LocalSet。

TaleChime 的资产、私有存储事务、包编解码和传输编排分别变化；公开 `VoiceLibrary` 不要求模型注册表。已校验预览和提交计划字段私有，资产只读，来源使用结构化包索引与音色身份；宿主不解析 ZIP 或匹配错误字符串。IPC 仅导出应用类型、受控会话 ID、名称、度量、错误码和结果，不传录音字节或基础库内部路径。

前端 `use-voice-library` 查询真实资产；`use-voice-transfers` 先订阅再查询，用任务 ID/序号合并事件与快照，关闭结果后拒绝迟到快照重新插入。列表只持有搜索、多选及对话框草稿。预置示例详情和真实资产详情分开，真实资产不能使用示例重命名/移除覆盖。

这些边界对应抽象、封装、模块化、信息隐藏；不引入通用仓储 trait、额外 runtime 或整批跨目录事务。`bindings.ts` 只由测试导出；包括 debug 包在内的应用启动不写源码目录，不依赖开发工作目录。

## 平台窗口与标题栏

`DesktopShell` 保留工程标签与空白拖动区，右侧不再重复显示产品名。`window-controls.tsx` 只渲染 Windows 右侧最小化、最大化/还原、关闭按钮；macOS 保留左侧原生交通灯，Linux 继续使用系统窗口装饰。`use-desktop-window` 从宿主读取平台，从 Tauri 查询并订阅聚焦、大小、DPI 与全屏状态；浏览器不显示虚假的窗口按钮。

`tauri.macos.conf.json` 使用 Overlay、隐藏原生标题、保留 decorations 和交通灯位置；Windows 配置关闭 decorations。平台配置的 windows 数组会替换基础数组，必须保留完整窗口尺寸、最小尺寸、标题和 label，不能只写增量字段。主窗口保持 1360×900、最小 1024×680。

Windows 原生最大化命中测试由 MIT 许可的 `tauri-plugin-snap-layout =1.0.9` 负责，目标为 React 按钮 `window-maximize`。插件不绘制 header，也不要求 `withGlobalTauri`。其两个命令仅在 Windows 的 main 窗口能力中授权。窗口操作只新增 minimize、toggle-maximize、close、start-dragging 四项权限；不授予前端 destroy、exit、任意窗口创建或系统辅助功能权限。

`desktop_window.rs` 集中管理原生关闭与退出边界，`window-close-guard.tsx` 展示会话中未保存工程/新建草稿和宿主当前模型下载/音色任务提示；确认后只能由宿主解除关闭拦截。macOS 预定义 Quit 直接执行 AppKit terminate:，因此默认菜单中的退出项替换为保留系统标题与 Cmd+Q 的受控菜单项。原生交通灯、Cmd+W、菜单退出和自绘关闭按钮共用相同确认，不绕过它强制销毁。工程标签关闭仍只关闭标签。

验证与平台限制见[标题栏验收记录](desktop-studio/window-header-validation.md)。

## 模型进度 Channel

模型资源订阅使用生成绑定 `subscribeModelResources(Channel<ModelResourceMessage>)`，不再广播 `model-resource-event`。Channel 首条消息为盘点快照，后续为带宿主任务 ID 和递增序号的更新。订阅在同一流锁内叠加盘点期间的并发更新、发送快照并登记；旧终态不遮盖后续磁盘盘点，旧任务或终态后的迟到更新不生效。页面离开显式取消订阅，WebView 重载回收其旧订阅；下载生命周期仍由引擎线程持有，订阅释放不取消下载。

TaleChime 下载回调通过 watch 槽保留最新文件进度，转发 future 与下载 future 同属一次 ensure，结束前补发最新值。宿主 `engine/progress.rs` 持续排空有界队列，按文件保留高水位，约每 100ms 发送最新聚合；EOF 立即补发，随后成功/失败终态立即进入 Channel。没有新下载字节时不伪造进度。前端使用浮点百分比，不等待整整 1% 才移动。

`openModelCache()` 由宿主读取当前生效的缓存配置、必要时创建目录，并调用 OpenerExt 的 open_path 在系统文件管理器中打开目录。前端没有路径参数，不新增任意路径打开权限。设置页和下载确认中的打开按钮复用同一组件。此操作只打开缓存目录，不更改位置或搬迁权重。

模型下载现使用 TaleChime 显式标准 HTTP 通道（共享 HF 缓存与 Range 续传），避免 Xet 网络接收与文件重建进度脱节、长时间显示零进度；单个在途请求 90 秒读超时返回类型化 Network，等待全局连接不计网络超时。宿主速率估算与传输实现分离，通过 Channel 输出速率/ETA，真实有界验收见[进度验证](desktop-studio/model-progress-validation.md)。hf-hub 已从 TaleChime vendor 迁至独立 fork 并固定 Git revision，来源和发布限制见其 `docs/knowledge/hf-hub-fork.md`。

暂停/继续、任务持久化与分片传输的职责和验收见[下载任务设计](desktop-studio/download-task-design.md)。宿主任务记录不得保存传输凭据或签名地址；暂停确认须等待传输 future 退出并检查断点保存结果。
