# MiniMax 国内模型

已提供 `MiniMaxConfig` / `MiniMaxModel` 库适配器和 CLI `--backend minimax`。库显式传入配置，不读取环境变量，使用调用方运行时；章节超时、取消、预算和有限校验反馈修复仍由 core 管理。

```rust
use castglean_model::{MiniMaxConfig, MiniMaxModel, DEFAULT_MINIMAX_ENDPOINT};
// 由宿主传入密钥；库不修改进程环境。
let model = MiniMaxModel::new(MiniMaxConfig::new(
    "MiniMax-M2.5", DEFAULT_MINIMAX_ENDPOINT, api_key,
)?)?;
// 在宿主运行时将 &model 传给 castglean_core::analyze_chapter。
```

`.env` 配置（文件已忽略；不要提交真实密钥）：

```dotenv
MINIMAX_MODEL=MiniMax-M2.5
MINIMAX_API_BASE_URL=https://api.minimax.cn/v1/
MINIMAX_API_KEY=replace-with-your-key
```

```powershell
cargo run -- analyze --backend minimax --source examples/minimal/chapter.txt --book demo --chapter ch-001 --output runs/minimax-demo
```

也可设置 `MODEL_BACKEND=minimax`。后端优先级为参数、进程环境、配置文件；MiniMax 的模型及端点变量使用独立前缀，不读取 GLM 凭据、`OUTPUT_MODE` 或 `REASONING_EFFORT`。显式 GLM 输出/思考参数会报错。当前本地配置的默认后端保持 local。

默认输出上限 8192 token、窗口 3000 字符/24 片段、请求超时 120 秒、章节超时 600 秒。需要时用 `--max-output-tokens`、`--timeout-secs` 调整；不自动重试服务错误、调整窗口或回退其他服务。

使用普通文本 JSON 和程序校验，不假设服务支持严格 JSON Schema。`reasoning_split=true` 分离思考，仅最终 `content` 参与校验；思考消耗可能包含在 completion token 中，无法取得明细时记为 null。截断直接失败，即使最终正文为空。客户端拒绝重定向、隐式网络重试以及大于 1 MiB 的响应，不回显服务错误正文。凭据仅随所配置端点的请求发送；远程端点必须 HTTPS，HTTP 仅允许回环测试。

2026-10-06 已用用户提供的订阅密钥验证国内端点能调用 M2.5。官方地址与订阅配置见 [国内接入说明](https://platform.minimax.cn/docs/token-plan/other-tools)，参数差异见 [Chat Completions 文档](https://platform.minimax.cn/docs/api-reference/text-openai-api)。M2.5 的思考不能按本地 Qwen 方式关闭，因此统计标为 `provider_default`；比较提示词收益应在同一模型、相同预算内进行。

六场景、两轮的真实前后对照见 [评测报告](attribution-comparison.md)：版本 5 没有显示稳定的语义增幅，不因 API 接入成功而宣称质量达标。
