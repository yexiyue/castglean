# 安全失败报告示例

公开人工构造的失败报告，正文为单字符 `A`，模型漏掉唯一目标，修复关闭。耗时为示意值 0，用量保持未知。它不代表真实模型实测，不是 checkpoint，不能作为提交凭证。

Schema 见 `schemas/analysis-failure.schema.json`；库报告只读且只能由执行器生成，JSON 解码不授予受信任状态。详情见 `docs/model-analysis.md`。
