# chapter-tool-agent-v1 公共冻结样本集

版本：`chapter-tool-agent-v1.0`。6 篇全新原创中文合成短篇，全部 `holdout`。仅用于方案 C 真实 Agent + tool 的 ECS/classic 对照；本次只创建与离线校验数据，不调用模型、不运行在线评测。

文本、规范身份、gold 与植错由 AI 作者编写并逐单元核对，**不是独立人工标注或人工真值**，也没有用模型回答作为评判器。没有私人小说、父工具提示或已跑模型结果。gold 是离线评分标签；不提供 gold oracle、gold 查询工具或基于 gold 的运行时答案。对照双方应只接收公共 evaluate.py 的 `adapter_input` 白名单：analysis 不含 reviewInput，review 含 reviewInput；两者均不得获得 gold、reviewGold、annotation 或本核对表。

所有偏移为原始字符串的 UTF-8 字节区间 `[start,end)`；gold 单元无缝覆盖全文，引号归所属话语，提示语及空白归叙述。非人声展示文字为叙述；嵌套称号不切换说话人；明确未出口的想法为 thought；不可识别的陌生声音为 unknown，不强配已知人物。同名人物以稳定 ID、职业和名牌区分。

每篇保留正确单元作预审负例，植错仅替换固定单元的 kind/speaker，不改源文或边界。reviewGold 精确列出全部且仅植错单元的正确标签。reviewInput 的 evidence 仅提供相应原文范围，不声称已被独立核验。

## 离线冻结与验证

必须先冻结再首次在线；数据冻结后不得按在线结果调 gold，同版本不可改标签。命令（在本 worktree 根目录执行）：

```sh
python3 /Volumes/yexiyue/castglean/scripts/ai_eval/evaluate.py freeze --dataset evaluations/chapter-tool-agent-v1 --dataset-version chapter-tool-agent-v1.0
python3 /Volumes/yexiyue/castglean/scripts/ai_eval/evaluate.py validate --dataset evaluations/chapter-tool-agent-v1
```

manifest 保存 evaluate.py 的规范 JSON datasetHash、goldHash，区别于文件原始字节 SHA-256。此集冻结时作者未调用模型；首次在线的执行顺序由父任务保证。小型合成集只能验证这些场景，不能代表真实小说或整体产品质量。

## AI 作者逐单元核对表

以下为原始单元解码文本（JSON 转义保留 CRLF、制表符与末尾换行）。每行核对文本、UTF-8 边界、语义归属及是否植错；未植错行为预审负例。

### holdout-tide-post：潮汐信箱

| 单元 | 字节范围 | 正确 kind / speaker | 植错为 | 原样文本（JSON） |
| --- | --- | --- | --- | --- |
| u1 | 0–69 | narration / narrator | — | `"海堤上的信箱进了沙。祁雨把铜钥匙递给莫舟，说："` |
| u2 | 69–96 | speech / c-qiyu | speech / c-mozhou | `"“先开右边那格。”"` |
| u3 | 96–126 | narration / narrator | — | `"莫舟没有伸手，反问："` |
| u4 | 126–159 | speech / c-mozhou | speech / c-qiyu | `"“你确定里面没有蟹？”"` |
| u5 | 159–175 | narration / narrator | — | `"\n祁雨笑了："` |
| u6 | 175–205 | speech / c-qiyu | — | `"“蟹可不会贴邮票。”"` |
| u7 | 205–286 | narration / narrator | — | `"莫舟这才接过钥匙。空信箱里滚出一枚贝壳，谁也没再说话。"` |

### holdout-dark-stair：暗梯回声

| 单元 | 字节范围 | 正确 kind / speaker | 植错为 | 原样文本（JSON） |
| --- | --- | --- | --- | --- |
| u1 | 0–102 | narration / narrator | — | `"停电后，叶槿独自守着楼梯口。隔着锁住的铁门，一个身份不明的陌生人喊："` |
| u2 | 102–129 | speech / unknown | speech / c-yejin | `"“有人带手电吗？”"` |
| u3 | 129–153 | narration / narrator | — | `"叶槿朝门外答道："` |
| u4 | 153–183 | speech / c-yejin | — | `"“有，你先别走动。”"` |
| u5 | 183–204 | narration / narrator | — | `"门外那人又说："` |
| u6 | 204–228 | speech / unknown | narration / narrator | `"“我就在原地。”"` |
| u7 | 228–325 | narration / narrator | — | `"\n灯恢复时，门外已经空了；叶槿始终没有看见那人的脸，也不知道姓名。"` |

### holdout-two-lu：两枚名牌

| 单元 | 字节范围 | 正确 kind / speaker | 植错为 | 原样文本（JSON） |
| --- | --- | --- | --- | --- |
| u1 | 0–93 | narration / narrator | — | `"北街木匠陆青和南街医师陆青在渡口碰面。佩木制名牌的木匠先开口："` |
| u2 | 93–117 | speech / c-lu-carpenter | speech / c-lu-medic | `"“我来修船板。”"` |
| u3 | 117–162 | narration / narrator | — | `"佩白瓷名牌的医师放下药箱，说："` |
| u4 | 162–192 | speech / c-lu-medic | speech / c-lu-carpenter | `"“我来给船工换药。”"` |
| u5 | 192–243 | narration / narrator | — | `"木匠陆青指着自己的木名牌补了一句："` |
| u6 | 243–282 | speech / c-lu-carpenter | — | `"“别把我的账记到他名下。”"` |
| u7 | 282–357 | narration / narrator | — | `"医师陆青点点头，把两张收据分别压在药箱和工具袋下。"` |

### holdout-title-in-quote：钟楼的称号

| 单元 | 字节范围 | 正确 kind / speaker | 植错为 | 原样文本（JSON） |
| --- | --- | --- | --- | --- |
| u1 | 0–93 | narration / narrator | — | `"宁舒把修好的钟摆交给冯伯。冯伯只是接过，没有说话。宁舒对他说："` |
| u2 | 93–174 | speech / c-ningshu | speech / c-laofeng | `"“他们叫你‘守钟人’，可我觉得‘补星星的人’更贴切。”"` |
| u3 | 174–198 | narration / narrator | — | `"冯伯听完才回答："` |
| u4 | 198–267 | speech / c-laofeng | narration / narrator | `"“‘补星星的人’这个称号太大，我只会拧螺丝。”"` |
| u5 | 267–294 | narration / narrator | — | `"宁舒指着表盘接话："` |
| u6 | 294–339 | speech / c-ningshu | — | `"“那就先把这颗‘星星’拧紧。”"` |
| u7 | 339–385 | narration / narrator | — | `"\n两人抬头，看见秒针越过了裂纹。"` |

### holdout-unspoken-seed：未出口的种子

| 单元 | 字节范围 | 正确 kind / speaker | 植错为 | 原样文本（JSON） |
| --- | --- | --- | --- | --- |
| u1 | 0–54 | narration / narrator | — | `"程栗看着闻禾掌心最后一粒种子，心想："` |
| u2 | 54–102 | thought / c-chengli | speech / c-chengli | `"“要是还不发芽，他会不会灰心？”"` |
| u3 | 102–180 | narration / narrator | — | `"这句话她没有说出口。闻禾并不知道她的念头，只轻声问："` |
| u4 | 180–216 | speech / c-wenhe | — | `"“窗边的位置还空着吗？”"` |
| u5 | 216–240 | narration / narrator | — | `"程栗点头，回答："` |
| u6 | 240–258 | speech / c-chengli | — | `"“留着呢。”"` |
| u7 | 258–303 | narration / narrator | — | `"闻禾把种子放进土里，暗自想道："` |
| u8 | 303–345 | thought / c-wenhe | thought / c-chengli | `"“明天再冷，我也要来看它。”"` |
| u9 | 345–376 | narration / narrator | — | `"\n屋里只剩浇水的细响。"` |

### holdout-glass-unicode：玻璃上的字符

| 单元 | 字节范围 | 正确 kind / speaker | 植错为 | 原样文本（JSON） |
| --- | --- | --- | --- | --- |
| u1 | 0–123 | narration / narrator | speech / c-zhaoning | `"赵柠在无人展柜前停下。玻璃上印着“请勿触摸”，旁边的电子屏静默显示「月相：🌘」。\r\n"` |
| u2 | 123–221 | narration / narrator | speech / unknown | `"屏幕下一行是组合字符“é”和汉字“𠮷”；这些都是文字，没有广播。\t"` |
| u3 | 221–251 | narration / narrator | — | `"赵柠低声念给自己听："` |
| u4 | 251–291 | speech / c-zhaoning | — | `"“这个字读吉，标记是🧭。”"` |
| u5 | 291–368 | narration / narrator | — | `"\n她没有念出告示。屏幕把“0”换成了“１”，仍未发声。"` |
| u6 | 368–386 | narration / narrator | — | `"赵柠心里想："` |
| u7 | 386–419 | thought / c-zhaoning | speech / c-zhaoning | `"“原来我看漏了一笔。”"` |
| u8 | 419–463 | narration / narrator | — | `"\n她拿出本子，画了一条短横线。\n"` |

