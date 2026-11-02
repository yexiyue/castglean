# 证据优先提示词与 MiniMax 对照

2026-10-06。本轮接入国内 MiniMax-M2.5，并对提示词 v3、扩展规则 v4、精简规则 v5 进行真实调用。v5 明确输入的已知角色与输出的新增身份，并将人物提取、表达类型、归属判断分开。业务协议和校验接受条件保持不变，没有用规则替模型直接写语义答案。

## 方法

采用六个原创公开场景：minimal、ambiguous、quoted，以及事先写定的 direct、bounded、offscreen。共八个 speech/thought 单元；每轮逐个运行，原文、书籍/章节 ID、窗口及修复预算保持一致。MiniMax 在 v3/v4/v5 各重复两轮；本地 v3 两轮、v4 中间试验一轮后停止，重启服务后另核查 v3，再运行 v5。

窗口均为 1000 字符/8 片段，最多 8 请求，每窗口一次有限修复，单请求 120 秒，章节 600 秒。本地 Schema、关闭思考、temperature=0、输出 2048 token；MiniMax 最终文本 JSON、reasoning_split=true、temperature=0、输出 8192 token。同模型内仅改变提示词；两个后端的输出模式与思考能力不同，不能作为同条件模型排名。

本地部署为 mistral.rs 0.9.4 / Qwen3-14B Q4_K_M，RTX 5070，4K 上下文，单并发；权重与部署记录见 [本地实测](qwen3-14b-local-test.md)。国内 MiniMax 地址及实测配置见 [接入说明](minimax-model.md)。提示词原文保存于 [v3](evaluations/attribution-prompts/v3.txt)、[v4](evaluations/attribution-prompts/v4.txt)、[v5](evaluations/attribution-prompts/v5.txt)。

## 线上已完成结果

| MiniMax 版本 | 发布成功 / 12 次 | 联合正确 / 16 单元 | resolved 中正确 | 成功运行中的请求 / 修复 | 成功运行输入 / 输出 token | 全部尝试墙钟秒 |
| --- | --- | --- | --- | --- | --- | --- |
| v3 | 11 | 11 | 8/8 | 13 / 2 | 10446 / 11173 | 120.954 |
| v4 | 12 | 10 | 8/10 | 14 / 2 | 13973 / 12089 | 132.313 |
| v5 | 11 | 11 | 8/9 | 13 / 2 | 10959 / 12922 | 150.455 |

失败单元按未交付计入联合正确率分母，不删除失败后再算准确率。v3 的 offscreen 第二轮修复耗尽；v5 的 ambiguous 第一轮缺少目标片段，修复耗尽。均未发布章节。成功运行的 token 包含已取得响应的失败候选；失败章节目前没有完整调用统计，所以表中 token 和请求数不代表全部成本。首次/修复成功次数指完成发布的运行，不能据此推算失败章节用量。

MiniMax v5 没有复现稳定的整体增幅：固定评分仍为 11/16，格式成功仍为 11/12，token 与时间增加。明确说话者与第一人称心理样例稳定通过；限定候选仍会在 ambiguous 与 unknown 间波动。v5 的同称呼身份命名更贴近原文，但这不足以推出整体归属质量提高。

首次无需修复即发布的次数，v3/v4/v5 分别为 9/10/9；修复后发布均为 2 次。所有调用由程序控制，没有模型确认轮次或网络重试。

## 本地中间试验与资源影响

v3 两轮共 12/12 发布成功、8/16 联合正确，16 个表达都被判 resolved，其中 8 个正确。累计 14 请求、2 次修复，13830/11388 输入/输出 token，墙钟 191.391 秒。

v4 首轮只有 direct 和 bounded 发布成功，六次尝试仅 2/8 联合正确；minimal、ambiguous、offscreen 截断，quoted 在修复时遇到服务错误。服务日志明确记录 CUDA 临时工作区约 1.04 GB 的显存压力与 HTTP 503；显存剩余约 600 MiB，解码速度也下降。因此停止重复轮次并取消一个在途请求，重启本项目的测试容器。已完成及取消记录保留，不能将这些资源故障归结为纯语义退化，也不能将重启后的速度变化归因于提示词。

重启后的 v3 核查六次均发布成功，语义为 4/8，与原两轮一致；输入/输出为 6915/5694 token。v5 两轮共 12/12 首次发布成功、8/16 联合正确，语义没有提高：

| 本地版本 | 首次发布 / 12 次 | 联合正确 / 16 单元 | 请求 / 修复 | 输入 / 输出 token | 全部尝试墙钟秒 |
| --- | --- | --- | --- | --- | --- |
| v3 | 10 | 8 | 14 / 2 | 13830 / 11388 | 191.391 |
| v5 | 12 | 8 | 12 / 0 | 11032 / 10624 | 177.343 |

本地在格式和开销上有改善：两次修复被省去，输入减少约 20.2%，输出减少约 6.7%。墙钟减少约 7.3%，但这只是包含服务状态影响的观测。v3 和 v5 的表达类型均为 808/808 原文字节正确，16 个单元均被判 resolved，只有 8 个与固定答案相符；排除两个争议场景后两版同为 8/10。角色表人工抽查还发现 v5 将书名当作人物，以及重复匿名身份、占位身份，当前评分没有覆盖这些问题。不能将格式成功提升包装成角色表或台词准确率提升。

## 评分局限

联合正确同时要求表达类型、归属状态及角色称呼与人工答案一致；以原文字节重叠对齐不同切片，独立角色 ID 通过 display_name 多重集合比较，不能证明复杂跨次身份一致。表达类型另按全部原文字节加权核对，成功产物还检查保存正文逐字节一致及 hash。

两个场景的金标有争议：ambiguous 第二句缺少明确语境，两个候选也可能合理；offscreen 可以用 unknown，也可能为原文明示的匿名发声者建立独立身份，身份不必有姓名。报告保持最初金标，不能把不匹配都说成客观语义错误。另列没有这两个争议场景的五个单元：MiniMax v3/v4/v5 两轮都是 9/10，没有观察到增幅。三个新场景用于补充检查，v4 结果之后又据错误调整 v5，因此它们已经成为开发样例，不再是严格留出测试集。

temperature=0 不保证线上跨次确定性；本轮没有随机化执行顺序、规模化盲审或统计显著性检验。小样本与服务资源状态限制结论，不能据此宣布模型质量达标或推广到真实小说。下一步应优先明确匿名身份及候选证据的标注规则、增加独立评测，避免继续只对这几个开发样例调提示词。

## 复核

公开逐次指标、参数、二进制摘要及输入摘要在 [评测记录 JSON](evaluations/attribution-comparison.json)。完整章节产物、二进制和本地服务日志继续留在忽略目录 `runs/attribution-comparison/`，不包含私人小说。新模型接入与测试代码不包含密钥，本机 `.env` 保持默认 local，可显式 `--backend minimax`。

```powershell
# 每次使用新标签，保留失败；不要覆盖旧的比较记录。
python scripts/compare-attribution.py --binary target/debug/castglean.exe --backend minimax --label current
python scripts/compare-attribution.py --binary target/debug/castglean.exe --backend local --label current
python scripts/evaluate-baseline.py --runs runs/attribution-comparison --prefix minimax-current-r1- --samples minimal ambiguous quoted direct bounded offscreen
```

`compare-attribution.py` 记录失败及 wall time，失败不发布仍保留在清单；`evaluate-baseline.py` 只评分已发布产物，不调用模型。复现旧版还需使用相应提示词的二进制，当前 CLI 不提供生产提示词覆盖参数。线上端点用量和时间不能保证复现。

本轮共完成 72 次章节尝试、66 个发布产物，另取消一次在途重复试验；所有发布产物另经独立 CLI validate 通过，保存正文及 hash 逐次核对。89 个 workspace 测试、2 个 doctest、fmt、Clippy、rustdoc 和五个 OpenSpec 变更严格校验通过。
