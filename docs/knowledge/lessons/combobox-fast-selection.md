# 组合框快速选择时的高亮时序

2026-11-14，macOS 上的浏览器自动化、当前仓库的 Base UI 组合框：角色候选搜索后快速连续按方向下键和 Enter，有时 Enter 到达时选项尚未标记高亮。原实现关闭列表并恢复原目标，用户输入看似被接受，实际仍是旧目标。

角色候选入口在搜索中、列表打开且没有高亮项时拦截 Enter，保留搜索和焦点；高亮可见后仍由 Base UI 完成正常选择。输入法组合中的 Enter 不拦截。实现见 [design-candidates.tsx](../../../src/components/projects/design-candidates.tsx)，浏览器测试见 [character-design-browser.mjs](../../../e2e/chapters/character-design.spec.mjs)。测试覆盖无高亮 Enter、继续选择、切换目标后恢复及绑定；不代表真实系统输入法和读屏验收。当前源码中这是唯一使用共享 Combobox 的业务入口，保护依赖该表单对未确认查询的语义，新增入口时应独立检查。
