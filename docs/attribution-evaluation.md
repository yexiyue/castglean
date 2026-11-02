# 独立归属评测用法

标注规则见 [标注政策](annotation-policy.md)，四十例原创数据见 `evaluations/attribution-v1/suite.json`。金标与划分在真实调用前冻结。历史六例仍使用原评分入口，不混入新基线。

本次实测使用 v1；复核发现的提及覆盖和称呼不足另存为冻结 v2，见 [勘误](attribution-evaluation-errata.md)。v2 通过离线校验但未调用模型，不能把它当成本次实测版本。下一轮显式使用 `--suite evaluations/attribution-v2`；本次报告继续核对 v1。

## 离线核对

使用 Python 3.10+ 标准库，无需 pip 安装。先构建 CLI（Windows 二进制带 `.exe`）。

```powershell
cargo build -p castglean-cli --locked
python scripts/evaluate-attribution.py verify --binary target/debug/castglean.exe
python -m unittest discover -s scripts/tests -v
```

运行 unittest 时设置 `PYTHONPATH=scripts`（PowerShell：`$env:PYTHONPATH='scripts'`）。Rust `offline` 测试核对全部四十例 Schema 与应用合同。`build-evaluation-suite.py` 是原始人工编写场景的构建记录，不能覆盖已经冻结的版本。修改金标必须创建新版本及说明。

## 固定预算运行

```powershell
python scripts/compare-attribution.py --suite evaluations/attribution-v1 --split all --seed 42 --repeats 2 --backend local --binary target/debug/castglean.exe --label baseline-v1 --runs runs/attribution-v1
python scripts/compare-attribution.py --suite evaluations/attribution-v1 --split all --seed 42 --repeats 2 --backend minimax --binary target/debug/castglean.exe --label baseline-v1 --runs runs/attribution-v1
```

每后端串行运行。随机种子只控制场景执行顺序；模型服务自身的采样设置另记环境，不能宣称线上模型确定可复现。`--split development|holdout|all` 可选组，默认 all；不指定 `--suite` 保留历史行为。输出预算本地 2048、MiniMax 8192，窗口 1000 字符 / 8 片段、每章 8 请求、每窗口一次修复、请求 120 秒、章节 600 秒。没有额外网络重试或回退。

运行清单先写入全部计划项，逐次原子保存实际执行顺序与源文、金标摘要。中断后的未执行项不消失，不能通过删除失败项提高分数。模型失败记录安全错误及未知用量 null。调用已获得但章节失败时 CLI 不公开统计；因此所有调用总费用可能未知，仅报告已观察成功章节用量，不能把失败费用当零。

## 评分与复核

```powershell
python scripts/evaluate-attribution.py score --binary target/debug/castglean.exe --manifest runs/attribution-v1/local-baseline-v1.json --report docs/evaluations/attribution-v1-local.json
```

先运行现有 CLI 应用校验，再验证源文字节、hash 和完整覆盖。按原文 UTF-8 字节交叠对齐；一个金标 speech/thought 单元所有交叠预测片段的类型与归属必须一致正确才得分。全文类型准确率按字节计算，含叙述与非对白引用。

身份映射只建立一次，边需要预测称呼与金标允许称呼相交，且预测人物证据范围完整覆盖至少一个金标身份提及。先求最大基数，再优先匹配仅属于一个金标身份的明确称呼；这一优先级不使用预测台词或金标归属。角色精确率 = 匹配数 / 预测人物数，召回率 = 匹配数 / 金标人物数。仍有多解时分别计算章内归属得分下界与上界，严格分数取下界；不逐句择优。搜索超过 10,000 完整匹配解时停止，标记 limit_exceeded，身份指标 null，联合归属保守区间而非正常对齐成功。

联合归属准确率包含类型、状态及身份集合的完整正确。resolved 准确率以预测为 resolved 的表达为分母，覆盖率以所有计划金标表达为分母。未知的合法归属同样可得分。状态矩阵单独描述来源判断，不能代替身份准确率。模型失败、无效和未执行仍占表达及字节分母，记 `not_delivered`；角色遗漏也包含未交付金标身份。

报告分别汇总整体、十类与两个划分，记录身份多解和上下界。完整产物、模型权重、私有小说与凭据留在忽略目录。短场景是诊断基线，不能外推长篇准确率，也不预设模型应达到某个分数。

身份对齐另有 `partial` 诊断：称呼匹配但证据未覆盖冻结提及，或证据覆盖提及但称呼不在允许表。严格分数仍按冻结规则计算；这类失败须复核是否为模型错误、真实身份混淆或评测锚点/称呼的边界，不能自动断言为错误归属。诊断不扩展允许表、不补金标锚点、不根据预测择优。若后续修改标注元数据，必须升级语料版本、重新冻结，并独立评测，不能覆盖本版报告。

## 原文引文与真实小说补充组

运行入口新增 `--evidence-mode segment-ids|verified-quotes`，默认保持旧模式。选择引文模式当前记录提示词版本 8（默认版本 7，采用窗口内短引用），使用相同窗口及预算，不把交付失败排除。`evaluations/literary-v1` 为六例单独的 supplemental 组，默认 `--split all`，原文及来源在调用前冻结，说明见 [小说语料](literary-evaluation.md)。原创 v2 与真实组分别对照，见 [引文实测](quotation-evaluation.md)。
