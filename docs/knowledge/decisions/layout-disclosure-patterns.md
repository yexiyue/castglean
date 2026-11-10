# 展开与折叠的布局稳定分流原则

日期：2026-11-10 · 适用：全应用详情面板/列表交互 · 状态：已定案并在角色中心落地，全站扫描完成

## 问题定性

展开/折叠导致布局跳动的行业名称是**布局不稳定（layout shift）**。[CLS 指标](https://web.dev/articles/cls)把用户点击后 500ms 内的位移排除在外——展开推挤在指标上"合法"，[NN/g](https://www.nngroup.com/articles/accordions-on-desktop) 也认可 accordion 为标准渐进披露。工作台 UI 体感差的根源是三个反模式：

1. **无动画的瞬时跳变**（[Material Expansion Panel](https://m1.material.io/components/expansion-panels.html) 要求展开带缓动）；
2. **位移波及无关内容**（推走的是下方所有兄弟区块，而非该块自身）；
3. **参考型数据参与布局**（"看一眼就走"的数据挤占文档流）。

## 分流原则（决定）

按交互中数据的性质选模式，不按习惯混用：

| 数据性质 | 模式 | 依据 |
|---|---|---|
| 参考型（统计/引用清单，看一眼就走） | **Popover 挂触发器**，零布局影响 | [Carbon Popover](https://www.carbondesignsystem.com/building-blocks/core/components/popover)、[表格 popover vs 展开行对比](https://dev.to/madsstoumann/designing-better-tables-using-popovers-for-extra-data-d1i) |
| 编辑型（改完才走：重命名/别名） | **就地替换**：表单替换显示行，行高近似不变，不在下方追加 | Notion/Linear 行内编辑惯例 |
| 长文分段（确需逐段展开） | Accordion：一次一个、带动画、展开自身区域 | Material/NN/g |
| 异步出现（任务结果/候选） | **滚动流内追加**（延长滚动，不压缩兄弟面板）或预留槽位 | [CLS culprits](https://developer.chrome.com/docs/performance/insights/cls-culprit) |
| 状态提示（失败/警示） | 顶部横幅压缩滚动区，不进入内容流推挤 | 应用既有横幅约定 |

## 落地案例（角色中心，变更 `restructure-character-center`）

- 使用统计：内联展开 → Popover（与 AI 面板「上下文用量」同模式），打开即拉最新数据。
- 重命名：表单向下追加 → 就地替换名称行。
- 配音/身份 Tabs：切换滚动复位；声音区按钮恒定（解绑禁用而非消失）。
- 失败提示：滚动区顶部 → 面板顶部横幅（带重试）。
- 列表列的任务队列/剔除条目折叠块/兜底候选：移入列表**滚动流 footer**——出现与展开只延长滚动，不压缩列表区。

## 全站扫描结论（2026-11-10）

- 已合规：`version-history`（列表/详情交换）、`boundary-editor`/`structure-actions`/`chapter-diagnostics` 历史（Dialog 浮层）、目录树展开（树内位移）、面板开关（面板可见性）、`split-proposal` 过滤切换（内容换帧）。
- 保留不改：`llm-settings` 新建连接表单在自身列表尾部追加（尾部位推挤范围小、设置浮层内）；工作台顶部状态横幅组（模型确认/失效警告/候选提示——全应用一致的横幅模式，属状态呈现而非展开交互）。
- 删除：`analysis/character-manager.tsx`（弹窗时代残留死代码，无引用）。

## 如何应用

新增"查看/展开"类交互前先问：这块数据**看完就走还是改完才走**？前者上 Popover 或放滚动流，后者做就地替换；只有真正的长文分段才用 accordion，并且必须带动画。
