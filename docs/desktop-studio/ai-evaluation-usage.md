# 正式AI评测

先阅读[评测契约](ai-evaluation-contract.md)。仅保留一个运行入口和对应测试，不维护旧实验适配器。

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run --message-format=json
python3 -m unittest discover -s scripts/ai_eval -v
```

从Cargo输出选择 `castglean_lib` 的测试可执行文件。模型配置JSON只含 `configPath`（宿主连接配置绝对路径）与 `selection:{connectionId,modelId}`，不含凭据。所有输入/输出应位于 `src-tauri/target/`。仅在已授权来源和模型调用时执行：

```sh
python3 scripts/ai_eval/run_production_agent.py \
  --binary /absolute/path/to/castglean_lib-test-binary \
  --config /absolute/path/to/native-config.json \
  --cases evaluations/chapter-tool-agent-v1/cases.jsonl \
  --output src-tauri/target/production-agent-eval-new
```

输出目录必须不存在且被Git忽略。`plan.json` 记录冻结身份和计划分母；每例结束保存独立结果与递增 `summary.json`。分析/预审的请求、用量、耗时和失败保留在结果trace；结构无效或预审失败不算交付。公开集已用于开发与历史实验，不宣称新的盲测。私人章节无gold时只报告结构交付与语义未测。

修改提示词、工具或上下文后使用相同公开用例比较不同实现身份；先通过离线测试，再决定是否进行真实调用。本轮代码清理未重新发起付费调用，既往模型冒烟见[正式接入记录](../knowledge/decisions/chapter-agent-production.md)。
