# Proposal

## Why

应用全程使用 Tailwind 默认刻度，间距没有 token 与角色定义：半档（6px/10px）与整档混用，相邻档差低于 25% 感知阈值，同类关系在不同位置取不同值（渲染实测栏高 44/48/40/56 四种并存、同一顶栏内 Home 按钮 `mx-3` 而新建按钮 `mx-2`），分组层级几乎全部由边线承担，间距没有参与节奏。工作台审计（impeccable layout，2026-11-17）确认这是当前界面观感的主要短板；参考《Refactoring UI》布局与间距章节的阶梯规则（相邻取值差距不低于约 25%）建立体系。

## What Changes

- 在 `desktop-interface-consistency` 新增"间距尺寸体系"要求：定义允许的间距档位、各档位的角色映射（控件内距 / 组内间隙 / 面板水平内边距 / 组间 / 区块间），以及结构栏高取值；阶梯按相对差距（相邻档不低于约 25%）选取，不要求线性倍数。
- 业务代码归位半档间距类：31 处，分布在 19 个文件（清单见 design.md）；`src/components/ui/` 组件库内 79 处保持上游原样，作为控件密度轴的显式例外。
- 结构栏高统一：`--app-header-height` 3rem → 2.75rem，侧栏品牌区与顶栏同为 44px；工作台无 chrome 时的 fallback header `h-10` → `h-11`；章节 header `min-h-14`（56px）保留。
- 消除同栏同类控件的边距不一致：desktop-shell 顶栏 Home 与新建按钮统一水平边距。
- 修复检查面板底部容器的双重水平内边距（`p-3` 容器内嵌 `px-3` 告警条）。
- DESIGN.md 的 Layout 段补充间距角色表，与 Shapes 段的语义圆角角色同构；`docs/engineering.md` 记录对应工程约束。

## Capabilities

- **New Capabilities**: 无。
- **Modified Capabilities**:
  - `desktop-interface-consistency` —— 新增间距尺寸体系要求（允许档位、角色映射、结构栏高），为"全页面可读与可操作"中间距一致性表述提供可核对数值。

## Impact

- **代码**：`src/index.css`（一处 token 值）、`src/components/desktop-shell.tsx`、`src/components/app-sidebar.tsx`、`src/components/projects/imported-workspace.tsx` 及半档类所在的其余业务组件（合计 19 个文件、31 处类归位，多数为机械替换）。
- **文档**：`DESIGN.md`（Layout 段）、`docs/engineering.md`、知识库索引。
- **不改动**：`src/components/ui/` 上游组件内部的内边距与按钮 `h-6/7/8/9` 密度刻度（shadcn 兼容优先，记为显式例外）；不改任何功能行为、数据格式或文案。
- **验证**：`pnpm lint`、`pnpm build`、样式单测、现有 e2e；工作台亮暗主题与中英文的窗口目验，重点核对头部带同高（44px）、面板节奏与无换行溢出回归。
