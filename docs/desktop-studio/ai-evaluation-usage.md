# 固定章节分析评测工具

2026-11-08。权威边界见 [v1 契约](ai-evaluation-contract.md)。Python 3.10+，仅使用标准库。工具与公开原创合成集已经可离线运行；本工具的离线测试不证明真实模型质量。角色发现准确率 **未评测**：这里显式提供已知角色 ID，禁止按显示名对齐。同名角色刻意使用不同 ID。公开答案由用例作者核对，尚无独立人工复核；见每例 `annotation`。7 个开发例、3 个留出例的规模只适合回归，不足以证明泛化。留出集虽公开，仍须单独运行，不能调参后声称盲测。

## 直接运行

仓库根目录执行。报告、原始响应与模型材料放在已忽略的 Cargo target 内，不提交 Git。默认报告只写摘要、case ID、错误分类、计数与 hash，不保存正文、姓名、提示词、响应或 argv；错误输出不回显 adapter stderr。

```bash
python3 scripts/ai_eval/evaluate.py validate
python3 -m unittest discover -s scripts/ai_eval -p 'test_*.py' -v

# 已有 adapter JSONL；未返回的所有计划 case 仍计失败，不能用结果文件选分母。
python3 scripts/ai_eval/evaluate.py score \
  --split development --mode replay \
  --results src-tauri/target/ai-eval/results.jsonl \
  --output src-tauri/target/ai-eval/replay-report.json

# argv 直接传 subprocess，不拼 shell。--adapter 必须最后，后续均为 adapter 参数。
python3 scripts/ai_eval/evaluate.py run \
  --split development --mode live --workers 1 --timeout 600 \
  --output src-tauri/target/ai-eval/recommended-report.json \
  --results-output src-tauri/target/ai-eval/recommended-results.jsonl \
  --adapter /absolute/path/to/adapter --route recommended

python3 scripts/ai_eval/evaluate.py compare \
  src-tauri/target/ai-eval/recommended-report.json \
  src-tauri/target/ai-eval/ecs-report.json
```

`run` 每个 case 先启动 analysis adapter 进程，再为有 reviewGold 的 case 启动独立 review 进程。每个进程 stdin 一行 JSON，stdout 必须恰好一行结果；处理后退出。analysis 输入绝不含植错候选，避免大部分正确的候选泄露分析答案；review 才收到候选。所有窗口/子请求编排由 adapter 负责。`--workers` 限制 case 进程数，不代表内部模型请求并发。超时/非零退出/错误 JSON 生成失败终态，仍继续其他 case；stderr 不落盘。超时只终止直接子进程，adapter 应在进程内管理任务并在退出时清理，不另起脱离进程组的请求守护程序。不自动重试模型。评分完成退出 0 表示生成了报告，不表示质量通过；输入不合法/重复或额外 case/冻结不匹配/不可比退出 2。

`--mode` 必须如实指定 `mock/replay/live`；`run` 不提供默认值。`score` 默认 replay。已标记 mock/replay 的结果或内建 controlled-mock 路线不能以 live 评分。live 仅标记调用者声明和 adapter 报告的在线来源，工具不能证明远端实际模型执行；mock/replay 报告永远 `offline-only`，比较结果也不称在线准确率。提供 `mock_adapter.py` 作为传输冒烟基线：它不读数据集或答案，只把整章标为旁白、预审报零问题，所以语义分数与预审召回必然较差；不产生虚构的模型请求或 token。没有内建 gold-oracle adapter。

```bash
python3 scripts/ai_eval/evaluate.py run --mode mock --split development \
  --output src-tauri/target/ai-eval/mock-report.json \
  --adapter python3 scripts/ai_eval/mock_adapter.py
```

## Adapter 数据形状

推荐路线的实际宿主适配器为 `scripts/ai_eval/recommended_adapter.py`。先运行 `cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run --locked`，取输出的测试可执行文件作为 `--binary`；它执行 ignored `protocol_experiment_bridge`，只在显式评测时读取原生凭据。`--config` 指向既有连接配置，`--binding` 指向事前选定的 JSON（`selection` 或 `configuration.selection`），不传密钥。公共评测禁用角色发现，使用提供的规范身份；完整人物发现需单独的授权样本验证。

```bash
python3 scripts/ai_eval/evaluate.py run --mode live --split development \
  --workers 1 --timeout 600 \
  --output src-tauri/target/ai-evaluation/recommended-development-v2.json \
  --adapter python3 scripts/ai_eval/recommended_adapter.py \
  --binary /absolute/path/to/castglean_lib-test-executable \
  --config /absolute/path/to/llm-connections.json \
  --binding /absolute/path/to/frozen-selection.json
```

提示词/Schema 调整时保留旧报告，推进 `compact::PROMPT_VERSION`，重新编译并用不同输出名运行。开发集修正结束再运行 `--split holdout`；比较相同 split 的报告，不能用开发集对留出集。新输入冻结提示词版本，不匹配的冻结输入停止执行，避免恢复时静默换协议。诊断实验可直接调用桥并显式设置 `captureResponses:true`，仅测试构建会把响应写入已忽略的 `target/workbench-acceptance/public-model`；默认适配器不开启捕获。

适配器只收到白名单字段；`annotation`、`gold`、`reviewGold` 不发送。输入的 `evaluationTask` 为 `analysis` 或 `review`；analysis 只含公共输入，review 增加 reviewInput。`source.text` 保留精确 BOM、CRLF、CR、LF 与组合字符。**不要把 `reviewInput` 当首次分析的答案**：两个独立进程分别分析正文与预审候选；不要让 adapter 跨进程写共享答案缓存。它可能正确，也可能含有意植入的错误。两项任务分别评分。

```json
{
  "version": 1,
  "caseId": "dev-explicit",
  "split": "development",
  "evaluationTask": "review",
  "source": {"text": "岚放下灯，说：“明早出发。”\n灯芯轻响。", "sha256": "实际SHA256"},
  "characters": [{"id": "c-lan", "name": "岚"}],
  "reviewInput": {"segments": ["公开候选，字段同输出 segments"]}
}
```

analysis/review 两类调用都返回 v1 结果；review 调用的 segments 不用于首次分析分数，analysis 调用自带的 review 不用于植错评测。runner 只合并 analysis.segments、review.review，并把独立预审 trace 放在内部 replay 扩展 `reviewTrace`，分别校验后汇总成本。已有单行 replay 可提供 reviewTrace；未提供时使用该行 trace，调用者须在实验记录证明 analysis 未接触候选，否则不能宣称独立分析质量。

输出遵循 v1：`version,caseId,route,status,segments,review,trace`。route 可为 `recommended` 或 `rig-ecs`。segments 必须非空、按序完整覆盖所有 UTF-8 字节，含空白；每段 `{start,end,kind,speaker,evidence:[{start,end}]}`。`kind` 为 narration/speech/thought；旁白必须 narrator，speech/thought 禁用 narrator。所有证据必须非空且在当前来源合法字符边界；工具验证坐标合法性，证据是否足以支持语义归属仍需人工审阅。歧义表示 `speaker:"unknown",candidates:["id1","id2"]`，至少两个不同的已知 ID；unknown 不得与候选混用。gold 的 `speakers` 是精确身份集合，候选集合不获得单一身份答案的正确分。

`review:{status:"completed",issues:[{start,end,suggestion:{kind,speaker}}]}`。每条 issue 必须精确定位植错的固定单元，不按文本解释猜测命中；suggestion 可用同样的 candidates 表达歧义。合法但未命中植错范围、重复命中或无效坐标都算误报；建议类型和规范身份与冻结答案相同才算有效建议。没返回 review 或未完成时，所有植错算漏检；无错 case 也进预审分母，检验误报。reviewGold 来自预先植错并与原始 gold 比对，judge 无权改答案。AI 预审完成不表示人工确认。

trace 可为数组或 `{spans:[...]}`。每 span 必须有：

```json
{
  "runId": "stable-case-run", "spanId": "request-1", "parentSpanId": "analysis-1",
  "stage": "analysis", "route": "recommended", "attempt": 1,
  "status": "completed", "startedAt": "2026-11-08T08:00:00.000Z", "elapsedMs": 1234.5,
  "isRequest": true, "requestId": "provider-call-1",
  "metadata": {
    "model": "实际模型ID", "configurationHash": "配置摘要",
    "promptVersion": "v1", "promptHash": "实际提示词摘要",
    "protocolVersion": "v1", "sourceHash": "与输入相同SHA256"
  },
  "usage": {"inputTokens": 100, "outputTokens": 20, "cachedInputTokens": 80, "reasoningTokens": null}
}
```

阶段 span 的 `isRequest` 为 false；模型请求为 true（未提供 isRequest 时，metadata 含 model 也识别为请求；显式 false 优先），每次真实请求只记录一次。不在父 span 重复填 usage。requestId 在 run 内唯一，没有时用 spanId。默认报告的 observability.traces 只保留契约字段和 allowlist 元数据，不复制原始诊断；可附 codeRevision/codeHash/datasetHash 追踪 adapter 实现。parentSpanId 必须存在且无环，每次 analysis/review 调用内的 runId 稳定；两次独立调用应使用不同 runId，避免 requestId 冲突，不同 case 也可使用不同 runId。时间须带时区，elapsedMs 非负真实观测。记录 prepare/identity（如有）/analysis/validation/review；未实际 publish 的原型不得伪造发布。失败流程仅记录已执行阶段。trace 不合法的输出记为无效交付。

缺失 token 字段为未知；`knownTotal` 只是已知部分，配套 `unknownRequests`，绝非总费用。没有分析请求记录的 case 单列 `requestAccountingUnknownCases`，独立预审 trace 缺失/不合法/无请求时另列 `reviewRequestAccountingUnknownCases`；因此失败/超时绝不自动成为零成本。缓存是 inputTokens 的子集，不额外加到输入；reasoningTokens 单列，不自动加到 output。阶段 `sumElapsedMs` 可因并行和父子 span 计时而超过端到端；并发峰值根据真实请求半开时间区间计算，`endToEndByCase` 是 trace 起止跨度；run.execution.elapsedMs 另记 Python 调度整体墙钟，不把 replay 解析速度当模型耗时。

## 冻结与比较

`cases.jsonl` 中的 gold 固定单元完整覆盖来源；`manifest.json` 冻结 canonical JSON 摘要（排序键、紧凑 UTF-8、禁止 NaN），以及 goldHash 和有序 caseIds。run/score 在任何 adapter 请求前完整验证冻结身份，不自动改答案。开发/留出选择不改变全数据集 hash，另记录 selectionHash 和实际 caseIds。datasetHash 也覆盖角色表、来源、来源说明、植错输入和预审答案。

修改公开用例时显式重新冻结并推进版本，不在普通运行中重建：

```bash
# 可选：重新生成原创公开语料；只写 cases.jsonl，不更新冻结摘要。
python3 scripts/ai_eval/build_public_dataset.py
python3 scripts/ai_eval/evaluate.py freeze --dataset-version chapter-analysis-v1.1
```

compare 要求 datasetHash/goldHash/datasetVersion/caseIds/selectionHash/split 和 configurationIdentity 相同，否则拒比。全局 configurationIdentity 集合只作初筛，另以 `configurationBindings[caseId][analysis|review]` 保存每个任务实际观测的配置集合、observed 与 metadataByStage。独立 reviewTrace 归属 review 任务；首次分析 trace 的所有阶段（包括流水线内的 review）归属 analysis 任务。未拆分 reviewTrace 的 replay 以 stage=review 标识 review，其余请求归 analysis。任务在计划中存在却没有合法请求 trace 时，集合为空、observed=false。

比较逐 case、逐任务核对非空配置集合，禁止配置在不同 case 或 analysis/review 之间调换；两侧都观测到不同集合时，即使提供相同显式身份也拒比。请求数、重试数和并行组数不同不导致拒比：同一任务相同配置的重复请求只计一次身份，但成本仍按真实请求累计。新增或减少阶段可以比较；模型、提示词版本/hash 与协议的差异在 `differences.caseStageMetadata` 按 case/task/stage 列出，不只比较全局集合，提示词跨 case 或阶段调换也可见。

全失败或部分任务没有 trace 时，只有两份新报告都事前用 `--configuration-identity` 声明相同配置身份，才允许保留这部分未知进行比较。声明不填充观测集合，也不把 usage、请求计数或缺失成本改为已知；比较结果的 configurationEvidenceComplete=false，并用 configurationUnknownBindings 列出未知 case/task 和两侧 observed。不要借声明掩盖已知配置差异。

旧报告不会被自动改写或补 hash。缺少任务绑定版本时，仅当每个计划 case 的请求 trace 都有同一个非空 configurationHash、来源 hash 匹配，并能从 analysis/review 阶段分别取得所需任务证据，才以 `legacy-uniform-case-trace` 推导配置比较依据；缺失 trace、来源不匹配或同 case 混用配置时拒比。此推导仅验证配置，不能补证历史程序版本；未知的新绑定版本也拒比。

配置 hash 应代表不含凭据原文的配置快照；不可为追求可比而删掉实际模型参数。scriptHashes/codeHash 在评测模块载入时、任何 run/score 操作前冻结，report 使用该快照的独立副本，执行期间不重新读取磁盘冒充已载入版本。run 另在调用 adapter 前记录 argv 中现有文件的 SHA-256（按参数索引标记，不保存路径），adapter 未通过 argv 直接提供的依赖代码摘要应另行保存于实验记录（不得只记 Git HEAD 冒充工作区代码）。正在运行的旧版程序不受此修复影响；此前 v1/v2 报告保持原样，实验记录须注明评分收尾读取磁盘摘要期间发生代码诊断修改的边界，不回填为新的冻结证据。不做结果缓存；重放记录 resultsHash，任何外部缓存必须使用来源/提示词/协议/配置/代码/数据集版本的完整键，并在实验记录说明。

`run --results-output <显式路径>` 可选保存每 case 一行的 adapter JSONL（runner 合并后的 analysis 结果、独立 review 和 reviewTrace），便于未来通过 score 离线重算而不再请求模型；默认不保存。它必须与报告路径不同，应放入忽略目录；未知 adapter 扩展可能含私人材料，不提交 Git。保存文件的 SHA-256 记入 execution.resultsHash；score 报告保存的是当次评分程序快照与输入 JSONL 摘要，不冒称原始在线程序版本。

## 指标边界

完整有效交付率、固定单元类型＋身份联合准确率、逐字节类型＋身份准确率，全部以选中的计划样本为分母；失败/半章/缺失均为零正确数。固定单元即使被模型拆成数段，只要每个字节类型与身份均相同就计正确。development/holdout 各自汇总。预审另计 expected/detected/missed/falsePositives/validSuggestions；缺失报告不能从分母消失。报告不含自动通过的在线质量阈值；必须基于真实固定数据实验再决定门槛。
