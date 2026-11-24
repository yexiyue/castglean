# Design

## Context

CastGlean 的共享执行器以 Rig AgentRunner 驱动模型与工具轮。宿主 SQLite 保存消息、工具回执和领域阶段，重试从这些事实还原。Rig 0.47 为现有执行器提供新版传输与 hook 接口，并允许同版本 AgentRun 状态序列化和续跑。

## Goals / Non-Goals

**Goals:** 升级共享执行路径，验证已提交工具应答的 AgentRun 能从序列化状态继续流式输出，并记录实际接入条件。

**Non-Goals:** 工作流自动推进、原生界面调整、模型上下文压缩和 AgentRun 检查点生产落库属于后续工作。

## Decisions

1. 保留 AgentRunner 及其内置 AgentRun。宿主通过新版 effect hook 继续记录模型请求、工具事实与用量，保持领域终止判定。传输保留大小限制、取消和响应保密边界，使用新版 HTTP 错误分类。
2. 在合成测试构造工具步骤，写入工具应答，序列化并恢复，通过 `Agent::resume(...).stream()` 核对首轮请求预算、工具结果和最终输出。
3. Rig 的流式驱动可以接收显式构造的 AgentRun，但常规 AgentRunner 的 hook 和流式事件没有公开中间 AgentRun 快照。如果后续确实要在模型轮中途续跑，可以为需要恢复的单项任务试点显式驱动 `next_step`。先在已提交工具应答的位置取检查点，验证工具的业务写入、命令回执和可恢复位置一致，再覆盖调用前后断电等情形。跨步骤制作继续由宿主持久化目标、授权和领域引用。

## Risks / Trade-offs

Rig 0.47 使用 AgentRun 格式 7，旧版格式 5 无法恢复。恢复时未应答的工具可能重新执行。存入数据库前需要限定检查点范围，验证故障切点与业务幂等，也需要处理检查点中的私有正文。当前宿主继续使用其领域恢复语义。

后续工程助手主运行的生产接入见[持久化变更](../persist-assistant-agent-run/design.md)。
