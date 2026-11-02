# 短引用协议开发集与小说对照

本轮共 208 次：Qwen 和 MiniMax 各 52 次新协议；GLM 旧、新协议各 52 次。每套均为两证据模式 ×（20 个开发场景 + 六个小说片段），每例一次。留出集未执行、金标未调整。Qwen/MiniMax 历史开发集每例两次，历史小说每例一次；GLM 对照双方均为本轮每例一次；按各自完整计划计算指标，重复次数、执行顺序和环境差异限制因果解释。本轮没有证明留出泛化。GLM 新默认开发组存在一个同名场景的身份匹配多解：严格正确下界 24/26，上界 26/26，不把这两句直接计作已确认语义错误。

默认版本从 5 到 7，引文从 6 到 8。变化为请求内短引用及相应说明，Schema 字段、最终格式和接受条件保持；同一后端串行，后端独立并行。窗口 1000 字符/8 片段，每章 8 请求，每窗一次修复，请求/章节 120/600 秒，本地/线上输出 2048/8192 token，无网络重试或自动回退。

| 后端 | 分组 | 证据模式 | 版本 | 交付/计划 | 联合正确下界–上界/表达 | 联合准确率 | 类型字节正确率 | 角色精确率/召回率 | 额外/遗漏 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| local | development | segment-ids | 5 | 32/40 | 18–18/52 | 34.6% | 63.6% | 66.7%/72.7% | 16/12 |
| local | development | segment-ids | 7 | 19/20 | 15–18/26 | 57.7% | 72.3% | 56.8%/95.5% | 16/1 |
| local | development | verified-quotes | 6 | 30/40 | 32–32/52 | 61.5% | 68.2% | 78.9%/68.2% | 8/14 |
| local | development | verified-quotes | 8 | 9/20 | 11–11/26 | 42.3% | 37.7% | 66.7%/36.4% | 4/14 |
| local | literary | segment-ids | 5 | 1/6 | 0–0/12 | 0.0% | 10.3% | 80.0%/26.7% | 1/11 |
| local | literary | segment-ids | 7 | 0/6 | 0–0/12 | 0.0% | 0.0% | —/0.0% | 0/15 |
| local | literary | verified-quotes | 6 | 0/6 | 0–0/12 | 0.0% | 0.0% | —/0.0% | 0/15 |
| local | literary | verified-quotes | 8 | 1/6 | 1–1/12 | 8.3% | 10.3% | 50.0%/6.7% | 1/14 |
| minimax | development | segment-ids | 5 | 39/40 | 51–51/52 | 98.1% | 97.4% | 100.0%/93.2% | 0/3 |
| minimax | development | segment-ids | 7 | 20/20 | 25–25/26 | 96.2% | 99.3% | 100.0%/95.5% | 0/1 |
| minimax | development | verified-quotes | 6 | 35/40 | 43–43/52 | 82.7% | 86.0% | 97.4%/84.1% | 1/7 |
| minimax | development | verified-quotes | 8 | 19/20 | 23–23/26 | 88.5% | 92.8% | 100.0%/90.9% | 0/2 |
| minimax | literary | segment-ids | 5 | 5/6 | 8–8/12 | 66.7% | 77.2% | 100.0%/73.3% | 0/4 |
| minimax | literary | segment-ids | 7 | 6/6 | 7–7/12 | 58.3% | 83.3% | 61.5%/53.3% | 5/7 |
| minimax | literary | verified-quotes | 6 | 1/6 | 3–3/12 | 25.0% | 11.3% | 100.0%/13.3% | 0/13 |
| minimax | literary | verified-quotes | 8 | 0/6 | 0–0/12 | 0.0% | 0.0% | —/0.0% | 0/15 |
| glm | development | segment-ids | 5 | 20/20 | 26–26/26 | 100.0% | 96.7% | 100.0%/100.0% | 0/0 |
| glm | development | segment-ids | 7 | 20/20 | 24–26/26 | 92.3% | 99.3% | 100.0%/95.5% | 0/1 |
| glm | development | verified-quotes | 6 | 20/20 | 26–26/26 | 100.0% | 99.3% | 100.0%/95.5% | 0/1 |
| glm | development | verified-quotes | 8 | 20/20 | 26–26/26 | 100.0% | 96.7% | 100.0%/95.5% | 0/1 |
| glm | literary | segment-ids | 5 | 5/6 | 8–8/12 | 66.7% | 85.9% | 100.0%/66.7% | 0/5 |
| glm | literary | segment-ids | 7 | 6/6 | 12–12/12 | 100.0% | 99.7% | 100.0%/86.7% | 0/2 |
| glm | literary | verified-quotes | 6 | 6/6 | 11–11/12 | 91.7% | 99.7% | 100.0%/93.3% | 0/1 |
| glm | literary | verified-quotes | 8 | 5/6 | 10–10/12 | 83.3% | 82.3% | 100.0%/80.0% | 0/3 |

## 用量与延迟

| 后端 | 分组 | 模式 | 版本 | 已观察请求 | 已观察输入/输出 token | 输入/输出已知章节 | 全部输入/输出 | 平均章节秒 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| local | development | segment-ids | 5 | 34 | 30356/22918 | 32/32 | None/None | 38.648 |
| local | development | segment-ids | 7 | 20 | 15273/3668 | 19/19 | None/None | 8.805 |
| local | development | verified-quotes | 6 | 30 | 33178/32112 | 30/30 | None/None | 51.421 |
| local | development | verified-quotes | 8 | 9 | 8641/2477 | 9/9 | None/None | 56.484 |
| local | literary | segment-ids | 5 | 1 | 1216/1611 | 1/1 | None/None | 82.013 |
| local | literary | segment-ids | 7 | None | None/None | 0/0 | None/None | 88.893 |
| local | literary | verified-quotes | 6 | None | None/None | 0/0 | None/None | 84.414 |
| local | literary | verified-quotes | 8 | 1 | 1060/542 | 1/1 | None/None | 65.875 |
| minimax | development | segment-ids | 5 | 46 | 38133/42505 | 39/39 | None/None | 10.118 |
| minimax | development | segment-ids | 7 | 21 | 14720/12219 | 20/20 | 14720/12219 | 7.584 |
| minimax | development | verified-quotes | 6 | 56 | 67394/65412 | 35/35 | None/None | 17.317 |
| minimax | development | verified-quotes | 8 | 29 | 27754/17716 | 19/19 | None/None | 10.695 |
| minimax | literary | segment-ids | 5 | 12 | 16482/16916 | 5/5 | None/None | 31.279 |
| minimax | literary | segment-ids | 7 | 12 | 10059/10323 | 6/6 | 10059/10323 | 20.510 |
| minimax | literary | verified-quotes | 6 | 3 | 5597/6770 | 1/1 | None/None | 42.846 |
| minimax | literary | verified-quotes | 8 | None | None/None | 0/0 | None/None | 26.273 |
| glm | development | segment-ids | 5 | 20 | 17204/8463 | 20/20 | 17204/8463 | 5.138 |
| glm | development | segment-ids | 7 | 20 | 15425/2688 | 20/20 | 15425/2688 | 2.510 |
| glm | development | verified-quotes | 6 | 20 | 21344/11941 | 20/20 | 21344/11941 | 7.038 |
| glm | development | verified-quotes | 8 | 20 | 19565/3739 | 20/20 | 19565/3739 | 3.027 |
| glm | literary | segment-ids | 5 | 10 | 13046/7156 | 5/5 | None/None | 19.656 |
| glm | literary | segment-ids | 7 | 12 | 11124/2913 | 6/6 | 11124/2913 | 8.164 |
| glm | literary | verified-quotes | 6 | 14 | 24506/14039 | 6/6 | 24506/14039 | 26.989 |
| glm | literary | verified-quotes | 8 | 10 | 11291/3164 | 5/5 | None/None | 11.226 |

None/null 表示成本未知，已观察用量只是已交付章节的下限；失败成本不能按零计，历史开发组总量对应四十次，本轮二十次（GLM 两方均二十次），不能直接用总量比值宣称节省百分比。平均耗时包含失败与修复，受本机负载及服务影响。

## 本轮失败、修复与身份对齐

### local / development / segment-ids

身份对齐：{'unique': 16, 'partial': 1, 'not_delivered': 1, 'multiple': 2}。已交付章节修复调用 1、修复成功窗口 1。失败与未对齐均保留，不只评分成功例。

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: analysis repair exhausted: duplicate target annotation at /segments/2/segment_id | 1 |
### local / development / verified-quotes

身份对齐：{'unique': 8, 'not_delivered': 11, 'multiple': 1}。已交付章节修复调用 0、修复成功窗口 0。失败与未对齐均保留，不只评分成功例。

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: invalid model suggestion: truncated response | 11 |
### local / literary / segment-ids

身份对齐：{'not_delivered': 6}。已交付章节修复调用 0、修复成功窗口 0。失败与未对齐均保留，不只评分成功例。

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: analysis repair exhausted: annotation outside target window at /segments/8/segment_id | 2 |
| Error: analysis: invalid model suggestion: truncated response | 4 |
### local / literary / verified-quotes

身份对齐：{'not_delivered': 5, 'partial': 1}。已交付章节修复调用 0、修复成功窗口 0。失败与未对齐均保留，不只评分成功例。

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: invalid model suggestion: truncated response | 2 |
| Error: analysis: model transport or service failed | 3 |
### minimax / development / segment-ids

身份对齐：{'unique': 20}。已交付章节修复调用 1、修复成功窗口 1。失败与未对齐均保留，不只评分成功例。

| 安全错误 | 次数 |
| --- | --- |
| 无 | 0 |
### minimax / development / verified-quotes

身份对齐：{'unique': 19, 'not_delivered': 1}。已交付章节修复调用 10、修复成功窗口 10。失败与未对齐均保留，不只评分成功例。

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: analysis repair exhausted: invalid or incorrectly scoped source quotation at /segments/1/attribution/evidence_quotes/1 | 1 |
### minimax / literary / segment-ids

身份对齐：{'unique': 4, 'partial': 2}。已交付章节修复调用 0、修复成功窗口 0。失败与未对齐均保留，不只评分成功例。

| 安全错误 | 次数 |
| --- | --- |
| 无 | 0 |
### minimax / literary / verified-quotes

身份对齐：{'not_delivered': 6}。已交付章节修复调用 0、修复成功窗口 0。失败与未对齐均保留，不只评分成功例。

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: analysis repair exhausted: invalid or incorrectly scoped source quotation at /characters/0/evidence_quotes/1 | 1 |
| Error: analysis: analysis repair exhausted: invalid suggestion structure | 1 |
| Error: analysis: analysis repair exhausted: source quotation not found in evidence segment at /characters/1/evidence_quotes/1 | 1 |
| Error: analysis: analysis repair exhausted: source quotation not found in evidence segment at /characters/1/evidence_quotes/2 | 1 |
| Error: analysis: analysis repair exhausted: supporting source quotation required at /characters/0/evidence_quotes | 2 |
### glm / development / segment-ids

身份对齐：{'unique': 19, 'multiple': 1}。已交付章节修复调用 0、修复成功窗口 0。失败与未对齐均保留，不只评分成功例。

| 安全错误 | 次数 |
| --- | --- |
| 无 | 0 |
### glm / development / verified-quotes

身份对齐：{'unique': 20}。已交付章节修复调用 0、修复成功窗口 0。失败与未对齐均保留，不只评分成功例。

| 安全错误 | 次数 |
| --- | --- |
| 无 | 0 |
### glm / literary / segment-ids

身份对齐：{'unique': 6}。已交付章节修复调用 0、修复成功窗口 0。失败与未对齐均保留，不只评分成功例。

| 安全错误 | 次数 |
| --- | --- |
| 无 | 0 |
### glm / literary / verified-quotes

身份对齐：{'unique': 5, 'not_delivered': 1}。已交付章节修复调用 0、修复成功窗口 0。失败与未对齐均保留，不只评分成功例。

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: analysis repair exhausted: annotation outside target window at /segments/8/segment_id | 1 |

## 结论与后续

短引用已通过还原与兼容验证，但真实收益依后端而异。GLM 默认小说组从 5/6 交付、8/12 联合正确，变为 6/6、12/12，平均章节耗时 19.66→8.16 秒；开发默认严格正确范围为 24–26/26，引文为 26/26，两者全部交付。开发完整输出用量分别 8463→2688、11941→3739 token，约减少 68.2% 和 68.7%；这不代表失败章节成本为零。

GLM 引文小说交付反而 6/6→5/6，联合正确 11/12→10/12。MiniMax 默认小说交付 5/6→6/6，联合正确 8/12→7/12，引文 1/6→0/6。Qwen 默认小说 1/6→0/6，引文结果见上表；它仍受截断、服务和引用错误影响。本轮不能宣称短引用或引文保证提高归属准确率。

保留隔离在 core 的短引用传输，继续默认片段证据模式，引文显式启用。后续可进入跨章身份与人工修正的确定性最小闭环；本地输出预算及窗口配置校准另行实验，不引入通用 Agent，不因本轮结果修改冻结答案或扩大预算。小说金标仍待独立人工复核。


## 复核与边界

离线服务比对新旧程序，默认及引文 Schema 与最终三个文档逐字节一致；示例 user JSON 从 278 字节到 129 字节，仅说明该输入的协议压缩。自定义模型须回传请求提供的 ID，映射及完整验证见 [实现说明](compact-window-references.md)。字符、片段和引文均恢复正式引用后校验，当前模式仍不提供语义证明。

本地仍为原 mistral.rs 0.9.4 / Qwen3-14B Q4_K_M / 4096 上下文 / 单并发，未重启或调整部署；MiniMax 为国内 MiniMax-M2.5；GLM 使用既有国内 Coding Plan GLM-5.3-Flash，low/json；实际配置见 observed_configurations。评测预览曾错误显示缺省普通接口，已依据 CLI 实际运行统计修正，未调整请求或结果。GLM 旧协议绑定上一轮固定二进制及其匹配历史报告中的源码摘要，明确记录 protocol_reference，不将当前源码误记为旧程序源码。冻结摘要、二进制及源码摘要、真实配置、时间、执行顺序和逐次指标保存在 docs/evaluations/compact-*.json。完整产物保存在忽略目录 runs/compact-protocol。小说金标尚未经用户独立复核，只有同一作者三篇作品的六个短片段，结果不能概括为长篇小说质量。
