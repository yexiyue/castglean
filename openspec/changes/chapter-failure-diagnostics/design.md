## Context
统计已在每次响应后更新，但错误返回丢弃本次局部统计。窗口纯校验只报告第一个遗漏。
## Goals / Non-Goals
补齐准备、窗口、最终校验的诊断及兼容入口；不改变第一轮模型请求或接受规则，不实现增量消费。
## Decisions
AnalysisFailure 保存原 AnalysisError 和只读 AnalysisFailureDiagnostics。详细入口共享执行函数，旧入口解包为原错误。BookAnalysisFailure、RunFailure 保留各层原错误及可选分析诊断。窗口通过内部诊断状态记录原文生成的目标 ID、短引用、字节范围、是否纯空白、全部遗漏及修复状态；不暴露模型输入值。所有响应在验证前统计，失败耗时在外层统一封装。前窗接受仅为私有候选，不构成发布或持久化。
CLI 可选 --failure-report 使用 create_new 写入 format_version: 1 的报告；路径预检，不覆盖。写入错误单独说明而保留主错误。验证脚本只读取有限、结构化字段，旧二进制不带新参数；未知历史用量保持 null。
## Risks / Trade-offs
增加详细入口但原入口不破坏；内存候选接受数不能作为提交数。报告为草案，未知响应与中断费用不能被已收到统计代替。
## Migration Plan
保持现有 DTO 和提交格式；诊断变化不更新分析配置指纹。覆盖修复另行变更和版本更新。新运行使用独立目录，保留旧运行。
