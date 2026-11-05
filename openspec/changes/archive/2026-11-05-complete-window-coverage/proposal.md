## Why
第一轮三章诊断在首章第十窗口发现 outside_target，模型返回第 25 项而该窗口仅有 24 个目标。现有 target 布尔字段和首个遗漏反馈不足以显式核对完整目标集合。
## What Changes
- 请求新增目标短引用清单与数量，反馈返回全部遗漏短引用。
- 失败窗口保存每次拒绝的安全问题，避免后一次错误掩盖初次遗漏。
- 如复测确认纯空白遗漏，程序负责完整纯空白片段的 narration，保留范围和证据可见性。
- 更新提示词与运行实现版本，最多使用剩余两轮验证；不增加预算、不放宽非空白覆盖。
## Capabilities
### New Capabilities
- `window-target-coverage`: 显式窗口覆盖责任与完整修复反馈。
### Modified Capabilities
无。
## Impact
core 协议、纯校验、CLI 指纹及示例、评测工具版本记录。旧计划不迁移，私有正文与金标不改写。
