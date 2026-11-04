import { msg } from "@lingui/core/macro";

/** Read-only design fixtures, never inferred from or written into imported projects. */
export type SampleVoiceBinding = {
  id: string;
  projectId: "sample";
  voiceId: string;
} & (
  | { kind: "character"; characterId: string; characterName: string }
  | { kind: "narration" }
);

export const sampleVoices = [
  {
    id: "sample-xiaoyue",
    source: "preset" as const,
    modelId: "moss/nano-candle" as const,
    name: "晓月",
    group: "female",
    tone: msg({ comment: "示例音色的听感描述", message: "沉稳叙事" }),
  },
  {
    id: "sample-linxian",
    source: "design" as const,
    modelId: "moss/nano-candle" as const,
    name: "临仙",
    group: "female",
    tone: msg({ comment: "示例音色的听感描述", message: "清亮轻盈" }),
  },
  {
    id: "sample-guyuan",
    source: "preset" as const,
    modelId: "moss/nano-candle" as const,
    name: "故渊",
    group: "male",
    tone: msg({ comment: "示例音色的听感描述", message: "低沉磁性" }),
  },
  {
    id: "sample-shixing",
    source: "reference" as const,
    modelId: "moss/nano-candle" as const,
    name: "拾星",
    group: "youth",
    tone: msg({ comment: "示例音色的听感描述", message: "明朗少年感" }),
  },
  {
    id: "sample-beichen",
    source: "preset" as const,
    modelId: "moss/nano-candle" as const,
    name: "北辰",
    group: "male",
    tone: msg({ comment: "示例音色的听感描述", message: "温厚自然" }),
  },
  {
    id: "sample-wujiu",
    source: "reference" as const,
    modelId: "moss/nano-candle" as const,
    name: "无咎",
    group: "male",
    tone: msg({ comment: "示例音色的听感描述", message: "苍老沙哑" }),
  },
];

export const sampleVoiceNames: Record<string, string> = Object.fromEntries(
  sampleVoices.map((voice) => [voice.id, voice.name]),
);

export const sampleVoiceBindings: readonly SampleVoiceBinding[] = [
  {
    id: "sample-main-narration",
    projectId: "sample",
    voiceId: "sample-xiaoyue",
    kind: "narration",
  },
  {
    id: "sample-zhang-voice",
    projectId: "sample",
    voiceId: "sample-guyuan",
    kind: "character",
    characterId: "sample-character-zhang",
    characterName: "张掌柜",
  },
  {
    id: "sample-lightkeeper-voice",
    projectId: "sample",
    voiceId: "sample-beichen",
    kind: "character",
    characterId: "sample-character-lightkeeper",
    characterName: "守灯人",
  },
];
