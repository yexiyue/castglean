# 冻结运行示例

`glm-plan.json` 使用 `../cross-chapter/` 的两章原创文本，包含空基础书、保存正文与完整分析配置。模型为国内 GLM Coding Plan `bigmodel::glm-5.3-flash`，low / JSON；1000 字符、8 片段、每章 8 请求、一次修复、120 / 600 秒，输出 8192 token。

计划不包含凭据。它是运行格式草案示例，不是准确率金标。模型环境与计划须一致；私有计划和产物应放在 `runs/`。用法与库示例见 [章节级恢复](../../docs/run-recovery.md)。
