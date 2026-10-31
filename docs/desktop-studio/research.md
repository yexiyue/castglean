# 产品交互调研记录

调研日期：2026-10-31。方法：阅读公开官方产品文档；未登录产品实操，未进行完整可用性或质量测评。界面位置、套餐和具体能力可能变化，实施前按需要复核。

本文选择有代表性的有声书、配音和模型辅助标注产品，不据此声称覆盖市场或证明某种布局具有统计意义上的主流占比。

## ElevenLabs Studio

官方文档描述章节组织、正文/声音与模型设置、音轨、段落生成历史及段落锁定。生成历史允许试听、下载和恢复较早版本。

借鉴：以长文和章节为中心；保留多个生成候选；满意结果可保护。具体侧栏位置不直接照搬，先按正文与检查任务设计布局。

来源：[Studio 概览](https://elevenlabs.io/docs/eleven-creative/products/studio)、[Generation History](https://elevenlabs.io/docs/help-center/product/studio/studio/what-is-generation-history-in-studio)。

## ElevenLabs Audiobooks

官方流程包含导入、单人/多角色选择、自动角色发现与选声、发音检查、生成和编辑。角色检测被明确描述为起点，可能遗漏小角色与未具名说话人；可以使用书中实际台词试听。

角色级换声会影响全书相关台词，文档说明已有音频会被清除并需要重新生成。CastGlean 借鉴影响范围提示，同时建议保留旧候选，避免换声失败丢失可用版本。保留旧候选是本企划的选择，不是对该产品行为的描述。

来源：[Audiobooks](https://elevenlabs.io/docs/eleven-creative/products/audiobooks)。

## Murf Studio

官方文档以正文块和子块组织脚本，选中后调整声音、语速、音高、停顿与发音。正文块与时间线块双向高亮，可分别试听块和项目；强调工具提供词级节奏与音高调校。

借鉴：正文与音频双向定位；设置与选区联动；听取上下文。现成模型的词级控制能力不能推定 TaleChime 的所有后端具备，界面按能力开放。

来源：[编辑器概览](https://help.murf.ai/murf-studio-basics)、[音频块双向定位](https://help.murf.ai/timeline-working-with-voice-blocks)、[强调调校](https://help.murf.ai/emphasisgen2)。

## Descript

官方文档描述从脚本选区触发 Regenerate，用周边音频作为上下文修复衔接，并提供试听、重试、保留和恢复。文档对应修复功能限英语，且有场景、声音与选区限制。

借鉴：局部修改后形成可比较、可撤回的候选。该能力与基于小说正文的角色识别不同，也不证明任意中文选区可以独立重生成。

来源：[Regenerate 局部修复](https://help.descript.com/script-editing/fix-take)。

## Microsoft Audio Content Creation

官方文档描述导入纯文本或 SSML、选声、选中内容试听、调整发音/停顿/语速/风格、保存和导出，并查看导出任务状态。

借鉴：把演绎调校放在文字选区旁边，试听后迭代；提供可检查的实际执行表达。它以语音参数调校为主，不证明已经解决小说场景级语义规划。

来源：[Audio Content Creation](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-audio-content-creation)。

## Label Studio

官方文档将模型预测作为可供检查与修正的预标注，保留预测的模型版本；预测本身只读，可作为新人工标注的基础。

借鉴：区分原始模型建议、人工修改和采用结果。它是数据标注工具，不能直接作为普通创作者的界面模板；本项目应减少标签操作负担，用待检查列表集中处理实际问题。

来源：[预标注与预测](https://labelstud.io/guide/predictions)。

## 调研形成的设计取舍

以下是本项目推论与建议，不是来源产品都具备的能力：

1. 正文、上下文检查面板和播放器适合作为首要交互；时间线辅助定位与衔接，自由节点画布后置。
2. 模型建议是可采用的制作草稿，人工检查与音频生成分别记录。
3. 角色身份、台词归属与声音绑定分别编辑；用真实台词选声。
4. 朗读规划同时呈现场景走向和段落意图，再检查下游实际执行，不把情绪标签直接等同于声音效果。
5. 通过候选、不可变生成记录与依赖失效支持安全迭代；修改设置不追改旧音频来源。
6. 待检查列表基于可说明的问题，不依赖未经校准的置信度；未知可以保留。

ComfyUI 在讨论中启发了队列、中间结果与可观测性方向；本轮未核查其具体产品能力，因此不把它作为节点兼容性或执行机制的实现依据。
