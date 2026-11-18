# Design: session-reasoning-effort

## Context

推理档位体系（`ReasoningSetting` + `reasoningCatalog` + 连接配置默认档）已存在于宿主；本变更只加"按请求覆盖"的通道与会话 UI，不改设置的默认档语义。

## Decision 1（D1）：配置字段与运行时单点接线

`Configuration` 增 `reasoning: Option<ReasoningSetting>`（serde default、None 不序列化；旧会话配置反序列化为无覆盖）。`ConnectionLease` 增 `completion_options_with(Option<ReasoningSetting>)`，移除仅委托默认值的 `completion_options()` 包装；默认调用显式传 `None`；覆盖档经 `reasoning::options(protocol, model_id, setting)` 现有校验，非法档返回错误。生产路径在 `jobs/runtime.rs` 将覆盖传给原生模型构造和 `completion_options_with(config.reasoning)`，两者保持一致；评测装置（efficiency/bridge）自建 ModelContext，不受影响。

## Decision 2（D2）：校验时机与错误映射

不在 `ai_start` 提前解析连接校验档位（与 selection/revision 的现有晚校验一致）：运行执行时非法档位映射为 `ConfigurationUnavailable`，会话按现有配置错误文案呈现。前端在提交前用 `reasoningCatalog` 过滤可选档，正常路径不会产生非法提交。

## Decision 3（D3）：会话 UI 与状态机制

- 新组件 `ReasoningPicker`：pill 触发器（当前档位短标签 + chevron）+ DropdownMenu（「跟随模型默认」+ 该模型目录档位），紧邻模型 pill；所选模型无目录条目时整个 pill 隐藏（该模型不支持档位）。
- 档位标签（极低/低/中/高/…）从 `llm-settings` 抽到 `lib/reasoning.ts` 共享。
- 状态机制完全复用模型切换：`effortKey`（null=跟随默认）与会话快照恢复、显式选择标记、`needsModelConfirmation` 比较（键含档位）、确认按钮同一处。模型切换时若当前档位不被新模型支持，回落 null。
- `ContextUsage` 弹层暂不展示档位（运行历史已冻结于会话上下文，需要时后续增量）。

## Decision 4（D4）：不动项

服务连接的按模型默认档语义、设置 UI（ReasoningSelect）、评测装置、章节分析等任务的 Generation 传递方式均不变；无新 IPC 命令、无 schema 迁移。

## 审查补充（2026-11-10）

原生 wire 默认选项承载本次运行覆盖，普通助手/分章/选角不能只接收默认档客户端而丢弃覆盖。非法档位在正常失败路径收尾，不能在领取运行后直接返回 IPC 错误遗留 running。Retry 准入与创建均从原运行读取配置，当前工具栏只控制新消息；Continue 携带新消息，是新交互轮次而非恢复原模型调用。增加连续工具回合原生 HTTP 夹具、旧运行重试和无效档位释放名额回归。
