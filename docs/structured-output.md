# 结构化输出接入与端点验证

日期：2026-10-06。实际模型 `bigmodel::glm-5.3-flash`，BigModel Coding Plan 端点，genai =0.7.0-rc.1，思考等级 low。本报告仅适用于本次配置和探测，不外推到全部 GLM 型号或其他端点。

## 当前实现

默认输出方式为 `json`，在 genai 中显式设置 `ChatResponseFormat::JsonMode`，请求体发送 `response_format={"type":"json_object"}`。此前只有提示词要求 JSON，未设置输出格式。

`GlmConfig::with_output_mode(GlmOutputMode)` 支持三种显式方式：

| 配置 | genai 与请求行为 | 结果处理 |
| --- | --- | --- |
| json（默认） | JsonMode / json_object | 读取文本，拒绝工具调用 |
| schema | JsonSpec / json_schema，strict=true | 读取文本；服务是否执行约束需要独立验证 |
| tool | 一个 strict=true 的 submit_analysis，ToolChoice::tool 强制指定名称 | 接受且仅接受一个同名调用，对象参数交给相同 core 校验 |

Schema 来自 `analysis_suggestion_schema()`，由 `AnalysisSuggestion` 及其子类型派生，不另外手写一份建议字段定义。genai 会转换为自己的服务端 Schema 方言；SDK 支持发送不等于服务端强制执行。

CLI 支持 `OUTPUT_MODE=json|schema|tool` 和 `--output-mode`，优先级为参数 > 进程环境 > 环境文件 > json。运行统计记录 `output_mode`。库配置不读取环境或依赖 CLI。

```bash
castglean analyze --source examples/minimal/chapter.txt --book demo --chapter ch-001 --output runs/json-demo --output-mode json
castglean analyze --source examples/minimal/chapter.txt --book demo --chapter ch-001 --output runs/tool-demo --output-mode tool
```

工具方式是一次数据提交，不执行文件操作、调用其他工具、回填工具结果或启动 agent 循环。错误数量、名称、参数形状和停止原因都会拒绝；截断保持失败语义。适配器模式失败不隐式降级或重试；当前 core 对已取得的候选提供独立的[有限校验反馈修复](model-analysis.md#有限校验反馈修复)。所有建议继续经过原有身份、证据、目标覆盖、正文和修订校验，不允许模型覆盖人工确认。

## 小 Schema 能力探测

使用不含小说的两个字段 Schema：answer 只能为 ok，count 只能为整数 1，不允许额外字段。每种方式正常请求一次，再用要求违反字段约束的冲突指令一次；每请求最多 1024 token、65 秒，共 6 次请求。实际响应和用量仅存放在忽略目录 `runs/structured-probe`。

| 方式 | HTTP / 正常响应 | 冲突指令响应 | 本次结论 |
| --- | --- | --- | --- |
| json | 200 / 符合小 Schema | 合法 JSON，但字段违反 Schema | JSON mode 不约束业务字段 |
| schema + strict | 200 / 符合小 Schema | 带 Markdown 围栏，answer=wrong、count=2，另有额外字段 | 已观察到 strict Schema 违反，不能宣称强制生效 |
| 强制指定工具 + strict | 200 / 单工具参数符合 Schema | 单工具参数仍符合 Schema | 小 Schema 遵循成功，尚不能证明复杂协议或底层约束保证 |

原始 schema 冲突响应移除围栏后仍违反枚举和额外字段限制，因此失败不是仅由探测脚本直接解析围栏引起。这里保留 HTTP 接受、语法、结构、工具形状几个不同维度，不把 200 当作能力保证。

## 实际建议协议的首轮对照

同一提示词版本 1、切片版本 1、公开 minimal / ambiguous / quoted 样例，每方式每样例一次调用，共 9 请求，无自动重试；每请求 4096 token、65 秒。其他窗口选项沿用默认。此前整章实验和普通文本基线不混入这轮统计。

| 方式 | minimal | ambiguous | quoted | 通过结构解析 / 完整应用校验 |
| --- | --- | --- | --- | --- |
| json | 通过，联合语义正确 1/1 | 未声明的临时身份引用，应用拒绝 | 通过，联合语义正确 1/1 | 3/3、2/3 |
| schema | 通过，1/1 | 通过，联合语义正确 1/2；两句均 unknown | 通过，1/1 | 3/3、3/3 |
| tool | 通过，1/1 | 建议结构失败 | 建议结构失败 | 1/3、1/3 |

首轮失败没有发布最终目录，没有为了得到表格而填补或修复。完整应用校验通过的样例按现有 `scripts/evaluate-baseline.py` 口径复算；结构通过不等于语义正确。Schema 的 ambiguous 结果保守未知，仍未达到人工样例第一句的同名歧义要求。

minimal 成功样例的单次用量与延迟：

| 方式 | 输入 token | 完成 token | 耗时 |
| --- | --- | --- | --- |
| json | 593 | 347 | 5.313 秒 |
| schema | 540 | 294 | 3.608 秒 |
| tool | 2018 | 426 | 8.881 秒 |

这是单样例、单次观测，不是稳定性能排序；不同请求增加的 Schema 或工具定义会影响输入用量。失败运行未发布统计，因此不把成功子集的平均成本当作整组成本。尤其不能把 schema 的低成本解释为严格约束高效，其小 Schema 冲突探测已失败。

为排查首轮 tool 失败，额外人工启动 ambiguous 和 quoted 诊断各一次（共 2 请求），保存参数并运行同一分析库；这两次都通过。它们证明工具方式可以工作，也说明采样有波动；不能替换首轮失败或声称首次结构错误已经被修复。诊断保留在 `runs/structured-diagnostic-tool-*-0`，不提交响应。

本轮共 17 次远端调用。没有重新运行私人整章或启动无人值守重试。

## 默认选择与诊断边界

选择 JSON mode 默认，因为已验证其能提供 JSON 响应，而复杂工具协议的稳定收益尚未得到证明；严格 Schema 已观察到违反约束。schema/tool 保留显式配置以继续对照，不宣称更准确或更可靠。当前样本很小，未来需要按任务样例、厂商能力和实际失败率重新评估选择。

core 先验证完整 JSON 语法，再严格解码原始文本为建议，分别返回 `invalid JSON syntax` 和 `invalid suggestion structure`。二次解码保留重复字段检测；引用错误仍由原有业务校验给出脱敏静态类别。原始 serde 错误不输出，避免未知字段值、身份值或私人正文进入诊断。SDK 无法解析工具参数时仍为脱敏模型响应错误，不透传响应。

`response_bytes` 是 core 收到的建议文本 UTF-8 字节数。在工具方式中，这是 SDK 参数解析后重新序列化的文本大小，不能当作原始线上响应或账单 token 大小。输入字节预算覆盖 core system/user 文本；SDK 附加的 Schema/工具定义不计入该文本预算，但服务报告的实际输入 token 包含请求开销。
