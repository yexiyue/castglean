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
| `src/lib/bindings.ts` | tauri-specta 生成的类型安全命令绑定；`cargo test --test specta_export` 或 dev 启动时刷新，勿手改 |
| `src/routes/`、`src/routeTree.gen.ts` | TanStack Router 文件式路由；路由树由 vite 插件生成并随仓库提交，不入 Biome 格式化 |
| `src/locales/`、`lingui.config.ts` | Lingui 文案 catalog（源语言 zh，目标 en）；`pnpm i18n:extract` 提取 |

界面不直接改写权威工程文件，不重复实现核心校验；权威状态在 Rust 宿主，前后端通过显式命令与快照通信。分层边界与流畅性约束见[技术选型](desktop-studio/technology-choice.md)。

## Rust 目录与模块约定

采用 Rust 官方推荐的新项目模块文件布局：`document.rs` 表示模块入口；出现实际子模块后，再增加 `document/normalize.rs` 等文件，由 `document.rs` 声明。避免仅为一个模块入口创建目录；本项目统一使用具名文件而非 `mod.rs`，便于编辑器定位。[模块文件指南](https://doc.rust-lang.org/stable/book/ch07-05-separating-modules-into-different-files.html)

模块默认私有，仅为跨模块访问使用 `pub(crate)`，面向使用方的类型和函数通过 `lib.rs` 的 `pub use` 导出。有意提供模块命名空间时才用 `pub mod`，避免把内部文件布局提前变成公开 API。

领域类型实现时，为角色 ID、章节 ID 等不同概念考虑 newtype；正文范围、已校验结果等具有不变量的类型使用私有字段与校验构造函数。JSON 输入 DTO 与已验证领域对象按需要分离，反序列化成功不能直接代表业务校验成功。[类型安全](https://rust-lang.github.io/api-guidelines/type-safety.html)

测试按作用域放置：模块内部单元测试用 `#[cfg(test)] mod tests`；跨公开 API 的集成测试放在 `tests/`。测试正文使用允许公开分发的短样例，不把私人小说放入 fixtures。

## 前端约定

路由用 TanStack Router 文件式路由（`src/routes/`，`autoCodeSplitting`，路由实例在 `main.tsx` 注册类型）。样式统一 Tailwind CSS v4 工具类，类序与冲突由 Biome 的 Tailwind 规则约束。UI 组件库暂缓，组件组织与状态方案随首个原型确定，不提前固化约定。

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

类型安全 IPC 由 tauri-specta 提供（`tauri-specta =2.0.0-rc.26`、`specta =2.0.0-rc.26`、`specta-typescript =0.0.13`，三者必须同源配套，见 `src-tauri/Cargo.toml` 注释）；错误处理用 Throw 模式，前端经 `src/lib/bindings.ts` 调用命令。国际化用 Lingui 6（`.po` 格式，源语言 zh）。路由用 TanStack Router（v1，vite 插件 `@tanstack/router-plugin`）。样式用 Tailwind CSS v4（`@tailwindcss/vite` 插件，`src/index.css` 引入）。

前端 lint 与格式化用 **Biome**（`biome.json`），不用 ESLint：项目明确不引入 ESLint，而 Tailwind 类排序、冲突类合并与 v4 遗留类检测这三条规则 Biome 2.6 内置（`nursery` 组，oxlint 无对应规则）。Biome 作用域只覆盖 `src/` 与根配置文件，docs、openspec、`.agents` 与自动生成的 `bindings.ts` 不在格式化范围。其余为 Tauri 脚手架依赖（`tauri`、`tauri-plugin-opener`、`serde`、`serde_json` 及 React/Vite 前端工具链）。模型接入（genai、Tokio）、持久化格式与测试依赖按实际工作流需要再引入，不提前添加；重启前的选择与验证记录见归档文档。
