# chapter-tool-agent-v1 公开回归集

保留6篇原创中文用例、来源/gold摘要和原核对表。AI标注不是人工真值；这些用例已被使用，不能再称为未见过的盲测。当前入口见[正式评测使用说明](../../docs/desktop-studio/ai-evaluation-usage.md)。模型仅接收正文、角色和别名，不接收gold、reviewGold或下表。历史植错字段保留为数据，不表示当前驱动已实现植错评分。

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
