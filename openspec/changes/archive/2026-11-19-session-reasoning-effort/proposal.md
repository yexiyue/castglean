# Proposal: session-reasoning-effort

## Why

宿主已有完整推理档位体系（`ReasoningSetting` 九档、按协议/模型校验的目录、服务连接里可按模型配置默认档），但档位只能作为连接配置的静态默认值——会话中无法按请求调整。ChatGPT/Codex 已把推理档位作为会话级控制（模型 pill 旁的档位选择）；我们的会话工具栏只有模型选择，档位能力"存在但无处可调"。

## What Changes

- 运行配置 `Configuration` 增加可选 `reasoning` 覆盖：未提供时沿用连接配置的模型默认档（现行为不变），提供时按所选模型的档位目录校验并生效于该次运行。
- 会话输入工具栏新增推理档位 pill：跟随所选模型展示其支持的档位（来自 `reasoningCatalog`），默认「跟随模型默认」；模型切换后档位选择自动校验，不支持的档位回落默认。
- 配置确认机制（`needsModelConfirmation`）涵盖档位变化：未经用户选择的档位变化仍须确认，与模型切换同一机制。
- 运行冻结档位：重试/恢复使用该运行创建时的档位，不读后续修改。

## Capabilities

- **New Capabilities**: 无
- **Modified Capabilities**:
  - `ai-conversation-controls`：新增「按请求推理档位」要求（会话内选择档位、目录校验、确认机制、运行冻结）。

## Impact

- **宿主**：`ai/types.rs`（`Configuration.reasoning` 可选字段）、`llm/config.rs`（`ConnectionLease::completion_options_with`）、`jobs/runtime.rs`（单点接线）。无新命令、无 schema 变更；旧会话配置缺字段按默认（无覆盖）反序列化。
- **前端**：`lib/bindings.ts`（specta 重导出）、`lib/reasoning.ts`（档位标签共享）、`ai-elements/reasoning-picker.tsx`（新）、`imported-workspace.tsx`（工具栏接入、确认与恢复机制复用模型切换逻辑）。
- **i18n**：中英文目录同步。
