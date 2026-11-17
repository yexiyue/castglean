# AG-UI Rust 类型对照实验

日期：2026-11-17；平台：macOS arm64，Cargo 1.99.0。此目录是独立研究项目，不链接到 CastGlean 应用，不修改数据库、不调用模型；目标是回答 typify 是否可直接生成，以及现成 `ag-ui` 类型是否值得复用。

## 固定来源与复现

- 官方仓库：`ag-ui-protocol/ag-ui` commit `79530a25f3476d0abb93cb00761906fda757a2d5`。
- `spec/1.0/schema.json` SHA-256：`4b5c93226838a0e72d88e6c5df20633c686c49fcb75d9be2815c6cbf9e48e71a`。
- typify：`0.10.1`，schemars：`0.8.22`；生成器依赖锁为 `Cargo.lock`。
- 对照 crate：`ag-ui 0.5.0-alpha.3`（KimSoungRyoul，MIT），发布包校验和 `f22233f15d7c14edbdf48cdde3db61421d50655b0f1e6d8cbf577f949b26c403`。探针关闭其默认特性，仅开启 schemars 导出类型字段表面；应用只用类型时无需开启 schemars。
- 独立判定器：Python `jsonschema==4.26.0` 的 `Draft202012Validator`。输入来自原始 schema，不使用降级投影作正确性判定。
- 生成物编译与对照 crate 的探针分别使用 `typify-probe.Cargo.lock`、`ag-ui-probe.Cargo.lock`。它们只锁独立实验，不更改应用锁文件。

从仓库根目录执行：

```bash
uv run --with jsonschema==4.26.0 python docs/research/spikes/ag-ui-typify/run.py
cargo fmt --manifest-path docs/research/spikes/ag-ui-typify/Cargo.toml --check
```

也可以在独立 Python venv 安装上述 jsonschema 后直接运行 `run.py`。需要 Cargo、Rust 及首次下载依赖/上游快照的网络。脚本下载固定 commit 的归档，只取 1.0 schema、fixtures、conformance 参考文件与上游 LICENSE；原始资料、生成 Rust、探针 crate、构建日志和 `report.json` 全在被忽略的 `target/`。**运行产物不提交 Git**。

脚本成功退出仅表示诊断按预期完成；raw 阶段的预期 panic 被保存为退出 101，任何后续编译失败会使脚本失败。非法输入被接受等差异照实写报告，不伪报成“完整一致性测试通过”。

## 方法

1. 校验固定 schema 哈希，并用原 Draft 2020-12 schema 核验 219 个官方 fixture 的合法/非法标签。
2. 原样调用 typify 的 `TypeSpace::add_root_schema` 与 `to_stream`。
3. 分别诊断“仅去除 not-null”和“再规范化 const/对象继承与封闭规则”；这些输入**不是与原规范等价的 schema**，特别是 not-null 已被放宽。
4. 独立编译每份生成 Rust，再按 fixture 类型反序列化、重新序列化，检查输出仍满足原 schema；额外把事件 fixtures 送入 Event 联合，避免单结构成功掩盖联合误选。
5. 用同一输入测试真实发布的 ag-ui crate。其 Event/Message payload 的判别字段由外层联合添加，因此测试使用 `Event`/`Message` 联合，而非把无 tag 的 payload 当线格式；`FileSource` 对应其 `InputContentSource`，`SubagentInfo` 对应 `SubAgentInfo`。
6. 通过该 crate 的 JsonSchema 导出 Event、Message、RunAgentInput 与 AgentCapabilities 字段表面，对比事件覆盖、消息字段与 capabilities 字段名。这里只核对字段存在性，不能推导约束完全等价。

## 实测结果

官方独立文档：135 合法 + 84 非法 = 219；额外 Event 联合探针：98 合法 + 55 非法 = 153。合计 372 次编解码探针，不能称为 372 个独立官方 fixture。

| 路径 | 生成/编译 | 官方合法接受 | 官方非法被接受 | 合法往返后不符合原 schema |
| --- | --- | --- | --- | --- |
| typify 原样 | 生成 panic（101） | 未运行 | 未运行 | 未运行 |
| typify 去除 not-null | 成功 | 135/135 | 42/84 | 5/135 |
| typify 结构投影 | 成功 | 135/135 | 18/84 | 0/135 |
| ag-ui 0.5.0-alpha.3 | 编译成功 | 135/135 | 21/84 | 0/135 |

加入 Event 联合后的相应非法接受数为 76、33、34；合法往返无效数为 10、0、0。所有可编译路径的 233 次合法输入均可解码。

### typify 的实际问题

原样生成 panic 摘要：`not yet implemented: unhandled not schema`，子 schema 为 `{ "type": "null" }`。

仅删除 12 处 not-null 会生成 `serde(untagged)` 联合，一些 const 没有形成严格判别类型，产生以下已复现的数据丢失：

- `SUBAGENT_FINISHED.outcome.interruptIds` 被丢弃。
- `RUN_FINISHED.outcome.interrupts` 被丢弃，原合法 JSON 因此变非法。
- JSON Patch `move/copy.from` 被丢弃，原合法补丁变非法。
- 文件来源的 `provider` 被丢弃，虽然输出还可能满足 schema，但语义已丢失。

结构投影进一步将 const 转单值 enum、展平当前 schema 的对象 allOf、将相应封闭对象改为 additionalProperties false，修复了此次合法 fixtures 的这些问题。该投影仍不能取代原 schema 的 null/数值/数组约束，不能作为未经原 schema 校验的生产类型来源。

### ag-ui 的覆盖与差异

- 官方 Event 联合的 **31/31 类事件**均存在，字段表面对照无缺失；还带有 5 类退役 THINKING 事件，应用不应发出。
- 官方 **7/7 类 Message 联合**及 RunAgentInput 的字段表面对照无缺失；本次覆盖子 agent 身份、Activity、suspended outcome、interrupt/resume、工具结构化结果与文件来源。
- `AgentCapabilities`/`MultiAgentCapabilities` 的合法输入里 `subagents` 会被静默丢弃，原因是 Rust `sub_agents` 经 camelCase 变成 **`subAgents`**。这是具体字段差异，不能称“全部 98 定义完全覆盖”。
- 官方 fixtures 的 16 次 JSON 变化中，14 次为默认字段补齐（role、replace、空 tools/context 等），另外 2 次为 capabilities 的 `subagents` 数据丢失。Event 联合的重复探针再增加 4 次默认字段变化，总数为 20；schema 仍有效不代表数据全保留。
- 21 个非法文档仍被 serde 接受，含 null、数值范围、空 interrupts、未知字段、JSON Patch 和退役内容形式等。类型可复用，协议验证不能省略。

**结论**：优先复用 ag-ui 的现成类型，关闭运行时特性并锁版本；按用户最终决定，不增加通用非法输入/schema 拦截，也不修正 capabilities 命名；宿主实际发送路径按标准构造并用行为回归核验。typify 试验保留作依据，不将其降级投影变成应用生成流水线，不另造全套 AG-UI 类型。

## 未验证边界

本实验未执行官方 conformance 流状态机 harness、第三方 crate 全部测试、assistant-ui/Tauri 接线、Rig 事件映射、数据库迁移、真实模型或原生桌面验收。schema/fixtures 的某些规范边界（例如 JSON Schema 数学整数与 Rust JSON 数字表示差异）也未穷举；字段表面完整不代表所有值与跨字段约束等价。

下一步见 [OpenSpec 任务](../../../../openspec/changes/rewrite-agent-ag-ui/tasks.md)；架构结论见 [调研](../../ag-ui-adoption.md)。
