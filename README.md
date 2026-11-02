# CastGlean

面向个人创作者的桌面有声书制作应用。围绕小说正文完成分析、检查、选声、生成、试听、修正与导出：模型提出建议，程序负责校验，人保留制作决定权。

当前状态：2026-11-02 仓库在 Tauri 2 脚手架上整体重启，尚未实现产品功能。重启前的分析库、schema、示例与 CLI 实现完整保留在 `legacy-main` 分支，仅作参考。

## 技术栈

- 桌面框架：Tauri 2（系统 WebView + Rust 宿主），选型依据见 [docs/desktop-studio/technology-choice.md](docs/desktop-studio/technology-choice.md)
- 前端：React 19 + TypeScript + Vite，TanStack Router 文件路由，包管理器 pnpm
- Rust 宿主：`src-tauri`，负责工程持久化与后台任务；选角、声音映射、候选与导出随产品功能落地
- 音频播放与波形组件待首个原型验证后选定

## 开发

```bash
pnpm install        # 安装前端依赖
pnpm tauri dev      # 桌面应用开发模式
pnpm build          # 前端类型检查与构建
cd src-tauri && cargo check   # 校验 Rust 宿主
```

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
- [ ] 首个原型：正文阅读区、检查面板与播放器同屏运行并验证流畅性
- [ ] 一章制作闭环：分析、检查、选声、生成、候选采用与导出
- [ ] 连续章节与整书批处理

详细规划见 [docs/desktop-studio/execution-and-roadmap.md](docs/desktop-studio/execution-and-roadmap.md)。
