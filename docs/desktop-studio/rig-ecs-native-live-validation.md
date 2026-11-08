# Rig ECS 原生 live 边界与固定评测

日期：2026-11-08。状态：隔离原型已实现并完成受控及已授权公开 live 验证；交付质量不达标，不建议迁移、合并或上线。正式应用与主工作区未改写。本分支后续只保留实验实现和证据，不继续在线调参或重跑。

## 实现与权限边界

显式 `native-live` feature 和 `--live-config` 才启用原生桥；默认离线模型不变。`AgentPlugin → Deliver → TurnCall → Serve/ErasedHandler → TurnOutcome` 是实际内核路径。原型只将白名单 CompletionRequest 转为原生 `op:call` job，原生 helper 按已有系统凭据边界取得密钥；Python 不打开凭据，不复制明文 key 或硬编码网关地址。

Live 使用实际用户 ModelSpec，不继承 DeepSeek 能力；容量来自选中非密钥配置，未知保持 null，metadata 明示 capabilitiesVerified=false。每请求 600 秒、无重试；Tokio supervisor 拥有子进程，取消/超时 kill＋wait，返回前等待监督任务清理。Ctrl-C/SIGTERM 传播父取消；SIGKILL 和远端停算不作保证。已开始 live 请求取消后保存 unknown，恢复不重发。

job/result 位于 package target 中独立私有临时目录，目录 0700、job 0600，正常结束/失败/协作取消后清理；helper stdout/stderr 不进公开报告。mode、helper 身份、路由、配置、来源、代码、提示、协议和数据集版本共同约束恢复；controlled helper 永远标为 mock，不能冒充 live。

## 冻结身份

- 模型：`zcode/GLM-5.3-Flash`；revision=1；contextWindow/maxOutputTokens 均 null；reasoning=low；scope=known-only，不评角色发现。
- configurationHash：`6350b3cb05c5699ee7d90c4f629c3189b3bdbec8bc1e1a99549cdf226b7682a9`，从实际非密钥配置核验计算，未伪造或手填结果。
- preimage：canonical sorted JSON `{configuration:{revision,selection},capacity:[contextWindow,maxOutputTokens],model:<实际API模型ID>,reasoning:"low"}`。scope、route、并发、代码、提示、协议另列。
- 原生桥：父任务提供的冻结 `src-tauri/target/ai-evaluation/frozen-v3/native-test-bridge`，调用现有 ignored test 的 op:call。helper 内容 SHA256 与文件身份由 Rust 检查并冻结，运行前后复核。
- 原型协议：`chapter-analysis-v1/ecs-owned-utf8-v2`，promptVersion=`ecs-evaluation-2`。start/end 的 Schema enum 限 owned UTF-8 边界，speaker enum 限规范身份；预审以候选边界生成 sN targets。
- 两组 live 使用同一原型 binary SHA256：`5748becae7245b422c76186ec64663f36777afb77bac87f16cbc357b80c8165f`。开发集后未修改执行代码、提示词或协议再跑留出；留出后未调参、未重跑。
- 固定数据：datasetHash=`099b24a5764827a9b4eae82eb421cff03d0f7b32f9f69dfcffb058e1d2ee8619`；goldHash=`4c8985235ece2ad3666bfbaf00b39496dddcbe034935b8ee1c0e3afb1951126f`。只使用公共原创 source，gold/reviewGold 不发 adapter。

## 开发与留出结果

两组均 workers=1，ECS 内部实际峰值 3；推荐路线峰值 2。失败样本始终保留在分母，不从部分结果、邻段或金标补齐，不放宽覆盖/身份校验。

| 指标 | 推荐 v3 dev | ECS dev | 推荐 v3 holdout | ECS holdout |
| --- | --- | --- | --- | --- |
| 合法完整交付 | 5/7 | 1/7 | 2/3 | 0/3 |
| 固定单元联合正确 | 10/19 | 2/19 | 4/12 | 0/12 |
| 字节类型＋身份联合正确 | 333/525 | 72/525 | 245/390 | 0/390 |
| 独立预审完成 | 6/7 | 7/7 | 2/3 | 2/3 |
| 植错检出 | 5/6 | 6/6 | 1/3 | 0/3 |
| 误报 | 3 | 1 | 0 | 4 |
| 有效建议 | 5 | 5 | 1 | 0 |
| 实际请求 | 26 | 29 | 11 | 12 |
| 调度墙钟（秒） | 149.185 | 120.676 | 88.411 | 71.130 |

ECS 开发集 6 个分析失败、留出集 3 个分析失败全部记录为 `coverage_or_utf8`：合法边界 enum 仍不能保证模型按序完整覆盖 owned 范围。它们不是据网络超时推测的失败；响应真实用量已记录，宿主校验未通过。留出另有一次独立预审 failed；合并结果没有保留该独立预审的详细错误码，现有证据不足以断言其具体 JSON/引用失败原因。

ECS dev 输入/输出 token 为 9808/7553（29 个请求均已知）；holdout 为 4573/4027（12 个请求均已知）。缓存输入与 reasoning 均为提供商报告的 0；不能将其他缺失用量默认为零。失败请求成本仍计入记录。

公共比较器两组均返回 comparable=true、configurationEvidenceComplete=true、qualityComparisonIsLive=true，逐 case/task 核对同配置；route、prompt、protocol 和阶段差异单列。它比较的是协议、切片、并发、预审、native helper 启动方式与运行时的路线组合。较短墙钟伴随大量失败，不能解释成有效交付加速，更不能归因 ECS 内核。

## 检查与证据

已完成检查，不据在线结果继续扩展验证：

- 原型默认离线 feature 的原 19 项测试通过；all-features 共 27 项测试通过。
- 公共 evaluator 当前 34 项测试通过；受控 native helper 的全部 10 个公共 case 合法交付，评分与公共全旁白/零问题控制基线一致，峰值 3；取消/超时的 scorer 证据通过。
- fmt、Clippy（all-targets/all-features、-D warnings）、rustdoc（-D warnings）和 OpenSpec strict 均通过。
- 子进程回收测试先等实际 helper PID 再取消，验证已退出；另测请求超时、无自动重试、snake_case 用量、缺失用量、脱敏失败、配置漂移和 mock/live 恢复隔离。

本 worktree 产物均在 `experiments/rig-ecs-prototype/target/`，不提交：

- `live-evaluation/development-v1/` 与 `holdout-v1/`：`report.json`、`adapter-results.json`、`adapter-results.jsonl`、`comparison-recommended-v3.json`、冻结 manifest/plan。
- `shared-checks/0f49fd2e-3dd8-4dd4-88d2-c442441f0e49/`：受控 helper 公共 suite、比较及失败证据。
- 父任务接手最终 compare；主树对应产物为 `src-tauri/target/ai-evaluation/comparison-recommended-ecs-{development,holdout}.json`，父任务确认均 comparable=true。主代码 `4ce87cf`，补充报告 `3c0a189`。

重评分可直接用公共 evaluate 的 score 读取保存的 JSONL，无需重新请求模型。调用入口和原生 manifest 格式见 [package README](../../experiments/rig-ecs-prototype/README.md)。

## 剩余边界

没有验证 Tauri 真实嵌入、生产 SQLite owner/generation 事务、原生 UI、Windows/Linux、真实小说质量或角色发现。独立 JSON 日志不替代生产发布与人工保护。原型没有自动采用或发布权限；AI 预审完成仍未人工确认。此轮结论为保留独立实验分支，不建议运行时迁移或产品上线。
