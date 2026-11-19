# FigCraft 组件库索引站企划

日期：2026-11-19。状态：**候选企划，未授权开工**；架构方向已在本日讨论中成形（GitHub 存原始文件 + PR 收录 + Actions 推 CDN/CloudBase 由用户提出并确认），实施顺序、仓库归属和部署侧重仍待拍板。依据见[FigCraft 生态调研](../research/figcraft-ecosystem.md)。

定位：**CastGlean 之外的独立开源项目**，因此本企划存于 `docs/initiatives/` 而非项目知识库（`docs/knowledge/` 只收 CastGlean 应用开发记录）。其中 P1 的 CastGlean 设计库与本项目 UI 工作直接相关（本项目 UI 用 shadcn Base Nova + Neutral 与 assistant-ui Base UI，设计稿需要对应 figcraft 库）；其余阶段与 CastGlean 应用开发无依赖关系，不得占用 CastGlean 主线资源。

## 背景与动机

- figcraft 没有任何 shadcn / assistant-ui / lucide 库文件；assistant-ui 连官方 Figma 设计文件都没有——内容空白是真实的。
- figcraft 社区库索引/注册表空白，官方短期无计划（公共目录只排在插件线），窗口期真实但用户基数小（约 5.1k star、alpha、parity ~47%）——这是买早期身位，不是即时流量。
- 差异化抓手：figcraft 的 `codeConnect` + Tailwind v4 导出可以做「设计↔代码 1:1」的库，这是现有 Figma kits 做不到的；CI 验证 + 版本管理是索引站区别于 awesome-list 的质量护城河。

## 目标

1. CastGlean 拿到与代码同源的设计组件库（直接目的，自用优先）。
2. 建立带版本管理与 CI 验证的 figcraft 库索引站；收录走 PR，分发走 GitHub + CDN。
3. 首发内容三个库：shadcn（Base Nova + Neutral）、lucide 图标（CI 从上游 release 生成）、assistant-ui 形态（Thread/Message/Composer/工具卡）。
4. 二期提供「粘贴链接一键添加 + 自动更新」：自建 figcraft-server 承载收录库。

## 非目标

- 不做账号体系：收录走 PR，GitHub 即身份；OAuth 只在 PR review 成为瓶颈后作为「代开 PR」便利层引入，本地用户表永远缓建。
- 不做插件：figcraft 插件无网络、公共目录未落地；图标等静态资产一律做库文件。
- 不依赖官方公共服务器分发（30 天过期、16 MiB、规则与控制权在项目方）。
- 不复制 shadcn 官方 Figma 社区文件或任何付费 kit 的设计资产——只按 MIT/Apache 代码与开源主题 token 重新建模。

## 架构（一期：纯 GitHub + 静态分发）

```
作者 PR（库文件快照 + manifest + 预览图）
  → 人工 review 合并（收录即审批，快照不可变）
  → GitHub Actions：headless figcraft 验证（加载/组件清单/minAppVersion）
      → 渲染 preview PNG → 生成聚合 index.json
      → 版本化路径推 CDN / CloudBase 静态托管
  → 用户：站上下载 .figcraft → 「添加库文件…」
```

- manifest 约定 `figcraft.library.json`：name / version / **minAppVersion** / previews / license / 组件清单——索引站的核心资产，站只是它的渲染端。
- 库文件快照进索引 repo（不引用作者 repo 活分支，防供应链问题）；更新 = 新 PR，后期做 bot 辅助代发。
- 两条分发路径分开认识：CDN 只服务「下载添加」；「链接添加 + 自动更新」必须自建 server（P3），CDN 替代不了。

## 分阶段

- **P0 技术验证（前置闸门）**：GitHub Actions Linux 装 figcraft release 二进制，headless 打开/校验/截图 .figcraft；确认生成路径（CLI/MCP 批量建组件）。不通过则 CI 差异化不成立，降级为普通 awesome-list 重新评估是否值得做。
- **P1 CastGlean 设计库（自用优先，与索引站解耦）**：变量层（Neutral 亮暗语义 token，与代码同源）→ 核心原语（Button 变体、Input、Select、Dialog、Sheet、Tabs、Tooltip…）→ assistant-ui 形态。先服务 CastGlean 设计稿，验收后再抽掉项目特定部分泛化成开源库。
- **P2 索引站 MVP**：manifest 格式定稿 → 索引 repo + CI 流水线 + 静态站 → 首发三个库；lucide 库挂 scheduled Action 盯上游 release 自动开更新 PR（示范版本管理能力）。
- **P3 一键添加**：自建 figcraft-server（倾向 CloudBase CloudRun 容器 + 持久盘，待验证；兜底轻量 VPS）→ 收录库 `publishToServer`（带 key，永不过期、64 MiB）→ 条目给 view link；给上游 #2434 补社区用例或提 PR（team-list link 作库源），采纳后切换到无 secret 链接。
- **P4 看反馈加码**：OAuth 代开 PR（提交量瓶颈时）、图标检索插件（#1883 网络 + M11 public catalogue 成熟后，数据仍走库文件）、与 figcraft.net 模板页合作投稿借流量。

## 风险与应对

- **figcraft 格式快速演化**：manifest 带 minAppVersion，CI 用对应版本二进制验证，旧版本产物永久保留。
- **官方未来自己做目录**：盯 M11 "public catalogue"；若插件公共目录先落地，评估目录协议是否通用可搭车，差异化守住「CI 验证 + 版本管理 + 设计库（官方只排了插件）」。
- **维护承诺**：库随 shadcn/assistant-ui/lucide 演化；bot 辅助 + README 明确维护状态，避免烂尾反噬信誉。
- **假冒站嫌疑**：官方发过仿冒下载站警告——明确开源身份、走官方渠道投稿，不做下载器只做索引。
- **引流预期**：figcraft 基数小，前期流量有限；指标看收录条目质量与 `library.usage` 插入量，不追 star。

## 待拍板

- 独立 repo 归属与命名（建议脱离 castglean 仓库，单独组织；索引 repo 与示例库 repo 分合待定）。
- 站点默认部署：GitHub Pages（全球受众）为主、CloudBase 静态托管为国内镜像，还是反过来。
- P1（CastGlean 库）与 P0/P2 的开工顺序与时间投入——建议 P0 验证先行（半天级），P1 随 CastGlean 设计工作自然推进。
- CloudBase 账号体系选择（国内站 vs 国际站，见 cloudbase skill 前置决策）。

## 待验证问题（P0 清单）

1. figcraft Linux release 二进制 headless 打开 .figcraft、列出组件、渲染 PNG 的可行性与命令形态。
2. CLI/MCP 批量生成 1500+ 组件（图标库）的耗时、文件体积与 Assets 面板浏览体验。
3. `library.publishToServer` 在 CI/headless 的可行性。
4. CloudRun 跑 figcraft-server：TLS 终结、持久盘挂载、server key 管理。
5. Actions 里密钥与第三方文件的安全边界（PR 触发的 workflow 权限收敛）。
