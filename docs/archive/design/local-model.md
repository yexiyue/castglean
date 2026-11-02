# 本地 Qwen 模型分析

已实现独立 LocalConfig / LocalModel 与 CLI 的 local 后端，当前验证服务为 mistral.rs 0.9.4、Qwen3-14B Q4_K_M。服务管理与权重下载在 CastGlean 外完成；程序不自动启动 Docker、下载模型或回退到 GLM。

## 本机使用

本机已经保留容器和权重，先启动服务并等待 `/v1/models` 返回：

```powershell
docker start castglean-qwen14b-probe
Invoke-RestMethod http://127.0.0.1:1234/v1/models
```

`.env` 配置为：

```dotenv
MODEL_BACKEND=local
LOCAL_MODEL=default
LOCAL_API_BASE_URL=http://127.0.0.1:1234/v1/
```

然后运行相同的章节工作流：

```powershell
cargo run -- analyze --source examples/minimal/chapter.txt --book demo --chapter ch-001 --output runs/local-demo
cargo run -- validate --characters runs/local-demo/characters.json --annotations runs/local-demo/chapter.annotations.json --source runs/local-demo/chapter.txt
```

输出目录必须不存在。取消、服务错误、截断、预算耗尽或最终校验失败不发布产物。Schema 仍需经过覆盖、身份和证据引用校验，也不能保证语义正确。

后端选择优先级为 `--backend` > 进程 MODEL_BACKEND > 环境文件 > glm（兼容旧用法）。local 只读取 LOCAL_MODEL 和 LOCAL_API_BASE_URL，忽略 GLM 的密钥、型号、思考及输出模式环境变量；显式 `--reasoning-effort` 和非 Schema 的 `--output-mode` 在 local 下报错。local 固定 Schema、关闭思考和 temperature=0。

本地默认目标窗口 1000 字符、8 片段、输出 2048 token；GLM 保持 3000 字符、24 片段和 8192 token。显式参数覆盖默认值；统计文件记录后端、配置的模型别名、端点、输出模式、实际用量、提示词版本与有效预算。default 是服务别名，部署的真实权重另见部署记录。

已保留的 GLM 配置可以通过 `--backend glm` 使用。没有自动回退，切换不会共用本地变量。测试后可执行 `docker stop castglean-qwen14b-probe` 释放显存。

## 独立库

```rust
use castglean_model::{LocalConfig, LocalModel, DEFAULT_LOCAL_ENDPOINT};

let model = LocalModel::new(LocalConfig::new("default", DEFAULT_LOCAL_ENDPOINT)?)?;
// 在宿主已有 Tokio 运行时内，传入 analyze_chapter(&model, input, &options, &cancel)。
```

库不读取环境文件或安装信号处理器。每次 generate 只发一个 HTTP 请求，发送核心生成的 JSON Schema 及输出上限，不携带认证信息，不使用隐式代理、重定向或网络重试。HTTP 响应限制为 1 MiB，建议另受核心 max_response_bytes 限制。认证、限流、服务和异常响应只返回安全错误类别，不打印服务正文。

本地保守窗口默认值只由 CLI 选择，库使用方需显式配置 AnalysisOptions，例如 window_segments=8、window_chars=1000、max_output_tokens=2048；核心默认值不因具体模型而改变。

## 部署与验证边界

本机 CUDA 镜像、权重哈希、完整启动命令及前期对照见 [Qwen3-14B 实测](qwen3-14b-local-test.md)。原部署配置上下文约 4K、单并发，全机显存占用约 11 GiB；扩大窗口或并发前需要重新测试。长章节宜分窗，并根据窗口数显式增加 max_requests 与章节时限，不能将模型最大上下文理解为当前部署可用预算。

提示词版本 3 已明确 narration/speech/thought/quoted_text 的含义及空白覆盖；版本 5 增加证据优先的归属指导，禁止按轮次或姓名距离猜测确定身份，逐句区分歧义与未知。产物格式与接受条件不变。本地端点必须支持所使用的 Schema 与思考控制；其他本地 OpenAI 兼容服务尚未验证。

## 正式 CLI 验证

2026-10-06，以本机 `.env` 和 local 默认预算直接运行三个公开样例，未用临时适配器、额外提示词或人工候选回放。输出记录在忽略目录 runs/local-cli-v3/local-{minimal,ambiguous,quoted}。

| 样例 | 完整校验 | 表达与归属联合正确 | 请求 / 修复 | 输入 / 输出 token | 耗时秒 |
| --- | --- | --- | --- | --- | --- |
| minimal | 通过 | 1/1 | 2 / 1 | 2363 / 1209 | 19.880 |
| ambiguous | 通过 | 0/2 | 1 / 0 | 975 / 1040 | 16.552 |
| quoted | 通过 | 1/1 | 1 / 0 | 960 / 917 | 14.749 |

首次通过 2/3 个窗口，另一个通过一次真实模型修复恢复；四次调用均有用量，未隐藏失败候选。合计联合正确 2/4，四个单元均被判 resolved，其中两个正确；表达类型字节加权正确 157/157。歧义样例虽然发现两个人物，却把应为 ambiguous 和 unknown 的发言都确定归属，存在过度确信。

三个输出均经过独立 CLI validate，保存正文逐字节与公开样例一致。reasoning 用量均未报告，保留 null，不假定为零。输入/输出总量 4298/3166 token，累计分析 51.181 秒，不含容器加载。服务目前保持运行，供继续本地使用。

本轮评分低于此前临时提示词补充组的 3/4，说明提示词位置、模型生成与服务执行条件的变化仍会影响结果；该观察无法区分各因素的贡献。小样本只验证接入和恢复链路，不构成小说质量验收。产物仍为 unreviewed，结构有效不能作为自动接受人物身份的依据。

本次 82 个 workspace 测试、2 个 doctest、fmt、Clippy、rustdoc 及四个 OpenSpec 变更严格校验均通过。CLI 测试还覆盖本地配置优先级、无 GLM 凭据、失败不发布及 GLM 兼容；HTTP 测试覆盖 Schema、用量、截断、安全错误、无 Content-Length 的超限响应。

后续版本 5 的六场景重复对照见 [归属评测](attribution-comparison.md)：本地省去两次格式修复，但未观察到联合语义得分提升；报告保留中间版本的截断、显存压力及重启记录。
