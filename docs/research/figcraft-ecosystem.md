# FigCraft 生态与组件库分发调研

日期：2026-11-19。状态：调研完成；由此产生的规划见[FigCraft 组件库索引站企划](../initiatives/figcraft-library-registry.md)。动机：CastGlean 设计稿需要 shadcn/assistant-ui 组件库，评估 figcraft 生态是否有现成资产与分发渠道。以下事实均标注来源；「待验证」小节是尚未实测的推断。

## FigCraft 本体

- [storytold/figcraft](https://github.com/storytold/figcraft)：Rust 写的 clean-room Figma 替代，MIT OR Apache-2.0，桌面（macOS/Windows/Linux/FreeBSD）+ browser + CLI + MCP server（400+ 命令与 UI 同一引擎）。官方站是 figcraft.org；figcraft.net 为非官方站（托管 web 构建与官方示例文件）。2026-11-19 org 页面显示约 5.1k star。
- alpha 阶段：官方自估 parity 约 47%，2026-11 初过 alpha 门；当前主线是 .fig 导入收尾、工具级 parity、multiplayer accounts/teams（[docs/roadmap.md](https://github.com/storytold/figcraft/blob/main/docs/roadmap.md)，2026-10 修订）。
- 官方 2026-10 发过假冒下载站警告，声明官方渠道只有 GitHub 与 getartcraft——第三方分发需要明确开源身份。

## 库（libraries）机制

- 文件内 publish 组件/样式/变量成为库；被引用有两条路径：①本地 .figcraft 路径（`library.add {path}`，UI 在 Assets 面板「添加库文件…」）；②figcraft-server 上文件的分享链接（view link 足够，UI 输入框「粘贴团队库链接（查看链接）」）。
- 更新：库文件 re-publish 新版本后，本地路径随文件更新，server 链接经 `library.check` / accept updates 自动收取。
- `library.usage` 提供插入/脱离统计（30/90 天/年、按组件/文件）。
- 已知坑：view link 的 token 会被原样存进每个使用该库的文件（[#2434](https://github.com/storytold/figcraft/issues/2434) 抱怨的点）；无 secret 的 team-list link 当前被 `Invite::parse` 故意拒绝（crates/collab-net/src/invite.rs:168）——"names a file of a server's team list, not its link: join with it first"。#2434 请求放开，状态 backlog + priority: medium，无 assignee、无 milestone、无维护者回复。
- `codeConnect` 可把组件挂到真实代码 import/模板，`inspect.code` 支持 Tailwind v4 导出——设计↔代码对齐是现有 Figma kits 不具备的差异化点。

## figcraft-server

- 无头 Rust 服务；官方构建内置默认公共服务器（`FIGCRAFT_DEFAULT_SERVER` 可替换），`open_publish = true` 时无 key 可发布。([docs/server.md](https://github.com/storytold/figcraft/blob/main/docs/server.md))
- 公共服务器限制：无 key 发布的文件 idle 30 天（`idle_days` 默认）即删；单文件 16 MiB；每 IP 20 文件 / 256 MiB / 10 publishes·h⁻¹；文件非端到端加密（运营方可读）；无账号，share link 即访问凭证（存 SHA-256）。
- 带 server key 发布：文件永不过期、单文件上限 64 MiB。
- 自托管成熟：Docker distroless 镜像、`install.sh`（Debian 12+/Ubuntu 24.04+，systemd + Caddy TLS；server 本体只说 ws://）。
- server team list（roadmap 2026-10-30 修订）：`team_files` 开启后到达 server 的任何人可见共享文件，走无 secret team links——官方已实现的、最接近「公共目录」的机制，但定位团队内共享。
- 插件目录（M11 已完成）：server 端 publish/browse/install/update；**public catalogue、发布者账号、签名仍在剩余清单**。

## 插件

- WASM 模块 + JSON manifest，只能经 figcraft 命令引擎行动（与 MCP 同套命令）；有 panel（浮动 UI）与 widget（画布层）能力。([docs/plugins.md](https://github.com/storytold/figcraft/blob/main/docs/plugins.md))
- **无网络**："no WASI: no file system, network, clock or randomness"；HTTP 访问是 open FR [#1883](https://github.com/storytold/figcraft/issues/1883)（priority: low）。
- 限制：模块 ≤16 MB、图片 ≤1 MB/张、fuel 10⁹/run；库链接不含插件（插件不进 branches/versions/library links）。
- 分发：本地导入（manifest + wasm）或 team server 目录；无账号，「server 的 key 就是发布者」。
- 结论：图标库等静态资产适合做**库文件**而不是插件（无网络 + 无公共目录两条硬约束）。

## 官方是否在做社区库索引

- 没有。[roadmap](https://github.com/storytold/figcraft/blob/main/docs/roadmap.md) 无 community libraries / registry / templates distribution 条目；官方只做团队协作方向（accounts/teams、team libraries、team list），公共目录只排在插件线（"a public catalogue"）。
- 模板生态极薄：应用内置 8 个 starter（File ▸ New from template），官方另有 5 个示例文件（Ridgeline design system 是唯一组件库示例）。
- 相关 issue：#2434（库源接受 team-list link，未排期）、#1883（插件 HTTP，low）、#2019（内置插件商店方向）。整体判断：生态分发不在官方主线上，窗口期真实。

## shadcn / assistant-ui / Lucide 的设计文件现状

- shadcn：只有 Figma 文件（[官方推荐 community file](https://www.figma.com/community/file/1203061493325953101/shadcn-ui-design-system)，全组件 + 变量 + 亮暗），无 .figcraft 版；第三方付费 kit 均为 Figma 格式。
- assistant-ui：无任何官方设计文件（检索到 GitHub issue #4138 明确设计稿未组件化；未逐字复核原文）。
- Lucide：无 figcraft 插件或库文件（Figma 有官方插件）；全量 SVG 开源可程序化转换。

## 法律边界

- shadcn/ui 代码 MIT、Base Nova/Neutral 主题开源、Lucide ISC、assistant-ui Apache-2.0：**按代码与主题 token 重新建模成 .figcraft 是干净的**。
- 不可复制：shadcn 官方 Figma 社区文件及第三方付费 kit 的设计资产（社区文件许可通常只许使用不许再分发）。

## 待验证（未实测）

- GitHub Actions Linux 上用 figcraft release 二进制 headless 打开 .figcraft、导出组件清单、渲染 PNG。
- 经 CLI/MCP 批量生成组件（1500+ 图标）的效率与文件体积；大组件数文件在 Assets 面板的搜索/拖放体验。
- CloudBase CloudRun 跑 figcraft-server：TLS 终结（server 只说 ws://）、持久盘挂载、server key 管理。
- `library.publishToServer` 能否在 CI/headless 完成（MCP 命令存在）。
