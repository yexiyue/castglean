# 独立归属基线数值报告

版本 attribution-v1；两后端各 40 场景 × 2 轮。失败仍计入计划与表达分母，严格联合分数取章内身份匹配下界。

规则及指标定义见 [评测用法](attribution-evaluation.md)。完整机器可读记录包含类别、划分、状态矩阵、执行顺序及逐次摘要。

## 按划分与整体

| 后端 | 划分 | 交付 / 计划 | 联合归属正确 / 表达 | 联合准确率区间 | 类型字节准确率 | resolved 准确率（下界） | resolved 覆盖率 | 角色精确率 / 召回率 | 额外 / 遗漏人物 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| local | 整体 | 63 / 80 | 34 / 102 | 33.3% | 70.5% | 55.7% | 59.8% | 62.7% / 67.3% | 44 / 36 |
| local | development | 32 / 40 | 18 / 52 | 34.6% | 63.6% | 60.0% | 57.7% | 66.7% / 72.7% | 16 / 12 |
| local | holdout | 31 / 40 | 16 / 50 | 32.0% | 76.1% | 51.6% | 62.0% | 60.0% / 63.6% | 28 / 24 |
| minimax | 整体 | 76 / 80 | 92 / 102 | 90.2% | 93.4% | 97.6% | 80.4% | 95.7% / 80.0% | 4 / 22 |
| minimax | development | 38 / 40 | 47 / 52 | 90.4% | 92.6% | 97.6% | 80.8% | 97.6% / 90.9% | 1 / 4 |
| minimax | holdout | 38 / 40 | 45 / 50 | 90.0% | 94.0% | 97.5% | 80.0% | 94.1% / 72.7% | 3 / 18 |

## 按类别

| 类别 | 后端 | 交付 / 计划 | 联合正确 / 表达 | 准确率区间 | 类型字节 | 角色精确率 / 召回率 | 额外 / 遗漏 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 明确说话 | local | 8 / 8 | 8 / 10 | 80.0% | 100.0% | 85.7% / 100.0% | 2 / 0 |
| 明确说话 | minimax | 8 / 8 | 10 / 10 | 100.0% | 100.0% | 100.0% / 91.7% | 0 / 1 |
| 可靠指代 | local | 8 / 8 | 8 / 8 | 100.0% | 97.0% | 100.0% / 85.7% | 0 / 2 |
| 可靠指代 | minimax | 8 / 8 | 8 / 8 | 100.0% | 100.0% | 100.0% / 64.3% | 0 / 5 |
| 持续发言 | local | 6 / 8 | 10 / 14 | 71.4% | 79.6% | 100.0% / 75.0% | 0 / 2 |
| 持续发言 | minimax | 8 / 8 | 14 / 14 | 100.0% | 100.0% | 100.0% / 100.0% | 0 / 0 |
| 有限候选 | local | 6 / 8 | 0 / 8 | 0.0% | 76.3% | 40.0% / 44.4% | 12 / 10 |
| 有限候选 | minimax | 6 / 8 | 5 / 8 | 62.5% | 73.7% | 100.0% / 77.8% | 0 / 4 |
| 无主声音 | local | 8 / 8 | 0 / 8 | 0.0% | 100.0% | 37.5% / 100.0% | 10 / 0 |
| 无主声音 | minimax | 7 / 8 | 7 / 8 | 87.5% | 87.3% | 100.0% / 100.0% | 0 / 0 |
| 匿名身份 | local | 6 / 8 | 4 / 16 | 25.0% | 70.4% | 37.5% / 60.0% | 10 / 4 |
| 匿名身份 | minimax | 8 / 8 | 15 / 16 | 93.8% | 100.0% | 90.0% / 90.0% | 1 / 1 |
| 同名人物 | local | 4 / 8 | 0 / 14 | 0.0% | 42.2% | 80.0% / 50.0% | 2 / 8 |
| 同名人物 | minimax | 8 / 8 | 11 / 14 | 78.6% | 100.0% | 78.6% / 68.8% | 3 / 5 |
| 别名 | local | 4 / 8 | 2 / 12 | 16.7% | 43.2% | 60.0% / 50.0% | 4 / 6 |
| 别名 | minimax | 7 / 8 | 10 / 12 | 83.3% | 86.9% | 100.0% / 58.3% | 0 / 5 |
| 心理活动 | local | 7 / 8 | 2 / 10 | 20.0% | 39.3% | 100.0% / 80.0% | 0 / 2 |
| 心理活动 | minimax | 8 / 8 | 10 / 10 | 100.0% | 100.0% | 100.0% / 100.0% | 0 / 0 |
| 非对白引用 | local | 6 / 8 | 0 / 2 | 0.0% | 66.7% | 33.3% / 50.0% | 4 / 2 |
| 非对白引用 | minimax | 8 / 8 | 2 / 2 | 100.0% | 96.0% | 100.0% / 75.0% | 0 / 1 |

## local 状态矩阵

| 金标 → 预测 | 表达数 |
| --- | --- |
| ambiguous->ambiguous | 2 |
| ambiguous->not_delivered | 2 |
| ambiguous->resolved | 4 |
| ambiguous->unknown | 2 |
| resolved->not_delivered | 27 |
| resolved->resolved | 49 |
| resolved->unknown | 8 |
| unknown->resolved | 8 |

## local 失败与匹配

| 状态 | 章节次数 |
| --- | --- |
| delivered | 63 |
| run_failed | 17 |
| 身份：multiple | 4 |
| 身份：not_delivered | 17 |
| 身份：partial | 6 |
| 身份：unique | 53 |

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: analysis repair exhausted: missing or invisible evidence at /segments/0/attribution | 2 |
| Error: analysis: invalid model suggestion: truncated response | 6 |
| Error: analysis: model transport or service failed | 9 |

## minimax 状态矩阵

| 金标 → 预测 | 表达数 |
| --- | --- |
| ambiguous->ambiguous | 6 |
| ambiguous->not_delivered | 2 |
| ambiguous->unknown | 2 |
| resolved->not_delivered | 2 |
| resolved->resolved | 82 |
| unknown->not_delivered | 1 |
| unknown->unknown | 7 |

## minimax 失败与匹配

| 状态 | 章节次数 |
| --- | --- |
| delivered | 76 |
| run_failed | 4 |
| 身份：not_delivered | 4 |
| 身份：partial | 3 |
| 身份：unique | 73 |

| 安全错误 | 次数 |
| --- | --- |
| Error: analysis: analysis repair exhausted: missing target annotation at /segments | 3 |
| Error: analysis: analysis repair exhausted: unknown existing identity at /segments/2/attribution | 1 |

## 用量与延迟

| 后端 | 已观察请求 | 已观察输入 / 输出 token | 用量已知章节 / 计划 | 全部输入 / 输出 token | 总章节耗时秒 | 平均章节秒 |
| --- | --- | --- | --- | --- | --- | --- |
| local | 68 | 62562 / 48444 | 63 / 80 | None / None | 2678.501 | 33.481 |
| minimax | 85 | 69577 / 77754 | 76 / 80 | None / None | 765.097 | 9.564 |

null/None 表示全部调用用量未知；已观察值仅是下限，不能作为失败成本为零的证据。章节耗时含失败、修复及本地冷启动影响，不含离线校验与评分。非对白引用类可以没有 speech/thought，联合准确率分母为零时显示 —，但类型和角色指标仍计入整体。
