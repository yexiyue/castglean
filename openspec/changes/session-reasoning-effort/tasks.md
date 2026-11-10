# Tasks

## 1. 宿主

- [x] 1.1 `Configuration` 增可选 `reasoning`；`ConnectionLease::completion_options_with` 覆盖默认档并走现有校验；`jobs/runtime.rs` 单点接线；验证：单元测试覆盖覆盖档生效、非法档报错、无覆盖沿用默认、旧配置缺字段反序列化为无覆盖
- [x] 1.2 specta 重导出 `bindings.ts`；验证：`cargo test --test specta_export` 通过

## 2. 前端

- [x] 2.1 档位标签抽共享 `lib/reasoning.ts`（设置与会话共用）；验证：设置页文案不变
- [x] 2.2 `ReasoningPicker` 组件（pill + 目录档位下拉 + 「跟随模型默认」+ 无目录隐藏）；验证：tsc/Biome 通过
- [x] 2.3 会话工具栏接入：`effortKey` 状态、会话快照恢复、`needsModelConfirmation` 涵盖档位、模型切换回落不支持档位；验证：tsc/Biome/test:ai 通过
- [x] 2.4 i18n 提取与英文翻译；验证：构建通过、目录无缺失

## 3. 验证

- [x] 3.1 全量门禁：cargo fmt/Clippy/宿主测试 + rustdoc + pnpm build/Biome；验证：命令输出全绿
- [x] 3.2 桌面验收：选择档位发送 → 请求带档位；切模型回落；确认机制触发；重试档位不变；验证：macOS 实操记录

## 4. 审查修复（2026-11-10）

- [x] 4.1 推理覆盖写入原生 wire 默认值，覆盖所有专业任务和连续工具回合
- [x] 4.2 Retry 的准入和持久化共用原运行配置，非法档位正常失败并释放名额
- [x] 4.3 本轮完整门禁与文档记录；原生桌面验收仍由 3.2 单列

验收证据：[2026-11-10 原生与真实模型记录](../../../docs/desktop-studio/voice-binding-acceptance-2026-11-10.md)。实际 HTTP 高档、跨任务、取消后冻结重试、不支持模型提示、原生重启恢复均已核对；未归档。
