# Qwen3-14B 本地部署实测

日期：2026-10-06。基于提交 `56fcb2e`，本次为独立部署及适配可行性测试，没有增加正式模型后端，也没有修改生产提示词。只使用三个公开人工样例，未读取或上传私有小说。

## 结论

RTX 5070 12 GB 可以通过 Docker Desktop / WSL2 运行 mistral.rs 的 Qwen3-14B Q4_K_M，40 个 Transformer 层全部放在 GPU 上。本次必须把部署可行性与业务效果分开：现有提示词直接使用时，普通文本组成功 0/3、Schema 组成功 2/3，而且有结构正确但表达类型错误的结果。补充表达类型定义与空白覆盖要求后，Schema 组成功 3/3，表达类型与归属联合正确 3/4。

这支持继续验证「本地服务 + model 适配器 + core 程序校验」，不支持直接替换 GLM 或宣称一般小说准确率达到 75%。样例极小，每种配置每样例只运行一次；诊断提示词是在观察第一轮问题后增加的，不能当作独立评测集成绩。

## 环境与配置

| 项目 | 实测配置 |
| --- | --- |
| 系统 | Windows，Docker Desktop 的 WSL2 Linux 引擎；Docker Engine 29.8.1 |
| GPU | NVIDIA GeForce RTX 5070，12227 MiB，驱动 616.56 |
| 内存 | 主机约 15.2 GiB；Docker/WSL 可用上限约 7.34 GiB |
| 推理框架 | mistral.rs 0.9.4，`cuda130-sm120-0.9.4` 镜像 |
| 权重 | Qwen 官方 `Qwen3-14B-Q4_K_M.gguf`，9001752960 字节 |
| 计算与缓存 | BF16；FlashAttention 与 PagedAttention 开启，KV cache 640 MB |
| 上下文 | 配置 4096，日志报告 PagedAttention 可用 4064 token |
| 并发 | `max-seqs=1`，`max-batch-size=1` |
| 生成 | temperature=0；服务 seed=42；`enable_thinking=false`、`reasoning_effort=off` |
| 分析 | 提示词版本 2，切分版本 1；其余窗口默认值；最多一次修复 |
| 预算 | 输出上限 2048 token；请求 180 秒；章节 600 秒 |

权重 SHA-256 已与 Hugging Face 官方 LFS 元数据核对：

```text
500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0
```

镜像摘要：`sha256:50df4ff5f5d4741b5553dfb960aa10858e6dd49e8f9377ba5731133358a2f1a1`。权重、官方配置、聊天模板、分词器和生成配置保存到忽略目录 `models/qwen3-14b/`。外部分词器报告 151669 个词表条目，GGUF 为 151936，框架自动使用 GGUF 内嵌分词器并忽略外部生成配置；基础中文输出正常。本次没有放宽该检查。

容器开始运行到 HTTP 服务就绪约 110 秒，其中权重加载约 88 秒；不含镜像及权重下载。基础中文预热请求耗时 110 ms，输入/输出 16/2 token，没有计入分析样例。样例运行中观察到全机显存占用约 10.9–11.1 GiB，剩余约 0.6–0.8 GiB；这些是采样值，包含桌面等其他进程，不是模型独占显存或精确峰值。长上下文与并发扩展尚未测试。

## 原提示词对照

临时 Rust 测试程序实现现有 `AnalysisModel`，通过 HTTP 调用本地服务，复用 `analyze_chapter`、建议校验、有限修复和最终章节校验。两组输入与预算相同：普通组依靠提示词要求 JSON，不发送 `response_format`；Schema 组发送由 `analysis_suggestion_schema()` 生成的 JSON Schema。不是将普通组视为 mistral.rs 不支持的 `json_object` 模式。

| 模式 | 样例 | 最终结果 | HTTP 请求 | 已报告输入/输出 token | 耗时秒 |
| --- | --- | --- | --- | --- | --- |
| 普通文本 | minimal | 两次都含多余 `text` 字段，结构校验失败 | 2 | 1697 / 737 | 14.264 |
| 普通文本 | ambiguous | 达到 2048 输出 token，截断后直接停止 | 1 | 893 / 2048 | 37.952 |
| 普通文本 | quoted | 首次建议被拒绝；修复请求返回 HTTP 503 | 2 | 878 / 1094，503 用量未知 | 18.905 |
| Schema | minimal | 完整校验通过；表达类型与归属联合正确 0/1 | 1 | 648 / 431 | 9.969 |
| Schema | ambiguous | 两次均缺少目标片段，修复耗尽 | 2 | 2514 / 1201 | 19.640 |
| Schema | quoted | 完整校验通过；联合正确 1/1 | 1 | 878 / 907 | 14.429 |

失败耗时取测试进程计时，成功耗时取核心统计，包含 HTTP 和验证但不含模型加载。所有失败均没有发布最终角色表、标注和正文目录；原始候选与失败诊断单独保留。503 原因尚未确定，没有加网络自动重试，也没有把失败重跑成成功后覆盖原记录。

Schema 组 minimal 将「张三说：」判为 speech、将实际对白判为 quoted_text，因此即使角色引用和正文范围全部有效，也不符合人工金标准。Schema 约束不能检查目标集合是否完整、证据是否可信或表达归属是否正确。

## 提示词补充诊断

只在临时测试程序中追加下列通用说明，保持 Schema、思考开关和其他参数不变：

> narration 是叙述，包括人物说话前的引导语，例如某人说：。speech 是人物直接说出的台词，包括包围台词的引号。thought 是人物内心想法。quoted_text 是书名等非对白引用。每个 target=true 的片段都必须返回，包括仅有换行或空白的片段，空白通常为 narration。严格禁止增加 text 字段。

| 样例 | 完整校验 | 联合正确单元 | 修复调用 | 输入/输出 token | 耗时秒 |
| --- | --- | --- | --- | --- | --- |
| minimal | 通过 | 1/1 | 0 | 730 / 431 | 7.148 |
| ambiguous | 通过 | 1/2 | 0 | 975 / 885 | 14.107 |
| quoted | 通过 | 1/1 | 0 | 960 / 907 | 14.575 |

合计首次成功 3/3，联合正确 3/4；已确定单元正确 2/2，另外两个为 unknown；表达类型字节加权正确 157/157，输入/输出 2665/2223 token，累计耗时 35.830 秒。歧义样例只建了一个「老张」角色，两句发言均 unknown，未保留应有的两个独立候选。

评分复用 `scripts/evaluate-baseline.py` 的范围重叠、表达类型和显示名多重集合口径，不能替代通用身份匹配或证据语义评审。与历史 GLM 小样本结果同为 3/4，但两者提示词、生成预算和执行条件不同，不能据此推断模型质量或速度相当。

共发送 12 次分析 HTTP 请求，其中 11 次成功响应有 token 用量，一次 503 无用量；另有一次独立预热。全部成功分析产物共五份，均通过独立 CLI validate，保存正文与公开样例逐字节一致。没有隐藏失败或把诊断结果混入原提示词组。响应报告的生成速率约 46–66 token/s，不包含下载、加载和输入预填充；前缀缓存开启且各次命中率不同，组间延迟不具备严格因果可比性。

## 复现与后续接入

准备好上述本地资产后，等价启动命令为：

```powershell
docker run -d --name castglean-qwen14b-probe --gpus all `
  -p 127.0.0.1:1234:1234 `
  --mount type=bind,source=D:/workspace/castglean/models/qwen3-14b,target=/model,readonly `
  -e HF_HUB_OFFLINE=1 `
  ghcr.io/ericlbuehler/mistral.rs:cuda130-sm120-0.9.4 `
  serve -m /model -f Qwen3-14B-Q4_K_M.gguf --tok-model-id /model `
  --chat-template /model/chat_template.jinja --max-model-len 4096 `
  --max-seq-len 4096 --max-seqs 1 --max-batch-size 1 `
  --pa-context-len 4096 --seed 42
```

测试容器已停止释放显存，保留容器和本地资产；可用 `docker start castglean-qwen14b-probe` 再启动。临时程序、逐请求输入/输出、用量、评分和启动日志位于忽略目录 `runs/qwen3-14b/`，正式 CLI 仍只提供 GLM 分析，不能用这个命令理解为已完成本地模型接入。

后续宜在 `model` crate 增加明确配置的 OpenAI 兼容服务适配，避免将 CUDA 依赖引入 `core`。提示词应明确表达类型，结构约束与应用校验继续并存。再扩充未参与提示词诊断的样例，测试真实章节、上下文边界、服务错误和取消行为；当前 12 GB 显存余量有限，不将整章放入一次请求。

官方参考：[Docker 部署](https://docs.mistralrs.dev/guides/deploy/docker/)、[GGUF 加载](https://docs.mistralrs.dev/guides/models/run-gguf/)、[结构化输出](https://docs.mistralrs.dev/guides/serve/structured-output/)、[思考控制](https://docs.mistralrs.dev/reference/openai-compatibility/)、[Qwen 权重](https://huggingface.co/Qwen/Qwen3-14B-GGUF)。
