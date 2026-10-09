# 窗口内短引用

默认提示词版本 7、引文版本 8 已使用短引用，CLI 参数、Schema 字段、最终 JSON 和正式身份不变。当前窗口模型输入片段以 s0、s1 表示，已有角色以 c0、c1 表示；反馈使用同一份映射。每个窗口重新建表，短名不是全局 ID。

自定义 `AnalysisModel` 应回传请求中的 id，不可假设它等于 `partition_source` 或角色表中的正式 ID。生成方法和 ModelRequest 字段未改；转换在 core 内部、校验之前执行。`AnalysisSuggestion` 可描述模型响应，但手工调用模型时同样须遵守请求内引用；建议以公开 `analyze_chapter` 编排入口使用库。

new temp_id 与 existing 隔离；例如 new c0 可以与 existing c0 同时存在，前者必须在本次响应声明，后者必须由请求提供。只有规范 sN/cN 及有效索引可还原；s01、s+1、越界索引、正式 ID 或错误前缀均拒绝。输出包含的正式 ID、来源摘要、字节范围、引文扩展仍由程序生成并验证。

纯转换不应用候选。还原后仍经过原有完整覆盖、证据、身份及精确引文校验；失败不改变角色表。安全反馈仅翻译程序产生的受信任片段引用，不回传任意拒绝值。截断仍直接停止，没有增加输出上限、网络重试或自动窗口调整。

短引用只降低传输长度，不能证明模型选择了正确人物或来源。实测使用冻结开发集与网上小说补充组，不使用留出集调参；比较历史结果时须披露不同重复次数及运行时环境。208 次三后端对照已完成，见 [实测报告](compact-protocol-evaluation.md)。


## 重现 GLM 新旧对照

GLM 沿用 `.env` 现有配置，不在命令中传凭据。保持同一后端串行、同一输入顺序、窗口及请求预算。新二进制使用正常运行入口；旧 v5/v6 二进制额外传 `--protocol-report`，仅用于冻结评测入口，历史报告须具有匹配的二进制摘要、版本、证据模式和源码摘要，否则在模型调用前拒绝。公开报告记录该历史文件摘要和来源方式，使用当前源码校验的摘要不冒充旧源码。

```powershell
python scripts/compare-attribution.py --binary runs/compact-protocol/binary/castglean.exe --backend glm --label development-segment-ids --suite evaluations/attribution-v2 --split development --repeats 1 --runs runs/compact-protocol
python scripts/compare-attribution.py --binary runs/quotation-evidence/quotation-binary/castglean.exe --backend glm --label legacy-development-segment-ids --suite evaluations/attribution-v2 --split development --repeats 1 --protocol-report docs/evaluations/quotation-literary-minimax-segment-ids.json --runs runs/compact-protocol
```

新旧程序的生成接口一致；引文对照使用 `--evidence-mode verified-quotes`，旧程序对应历史引文报告 `quotation-v2-minimax-quotes.json`。这里历史报告提供程序来源，与本轮 GLM 评分结果分开。已有运行名不会被覆盖，重跑须换标签。


## 验证记录

本次完成 103 个 workspace 测试、两个 rustdoc 示例和 35 个 Python 测试；fmt、Clippy（拒绝警告）、rustdoc（拒绝警告）、三套冻结语料校验与八个 OpenSpec change 严格校验均通过。离线服务探针验证两种模式的新旧 Schema 及三个最终数据文档逐字节一致；真实 208 次全部执行，逐次版本及固定二进制摘要核对通过，失败均不发布章节产物。公开报告含指标和安全错误，全文产物、固定二进制和运行脚本留在忽略目录。
