## Why
连续真实章节失败只留下错误类别，已取得响应的统计与失败窗口丢失，无法依据遗漏证据推进阶段 D。
## What Changes
- 新增详细分析及书级、运行级入口，保留原入口错误兼容。
- 返回安全窗口诊断、全部遗漏目标与失败统计；CLI 可输出独立失败报告。
- 第一轮真实验证保持模型协议与接受条件不变。
## Capabilities
### New Capabilities
- `analysis-failure-diagnostics`: 安全失败上下文与已取得响应统计。
### Modified Capabilities
无。
## Impact
涉及 core 编排、CLI 与连续章节验证脚本；不发布局部候选，不新增网络重试，不冻结 v1。
