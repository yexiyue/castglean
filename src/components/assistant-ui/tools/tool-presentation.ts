import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import {
  AudioLinesIcon,
  BookOpenIcon,
  FileTextIcon,
  GitCompareIcon,
  ListTreeIcon,
  type LucideIcon,
  MessageCircleQuestionIcon,
  PencilLineIcon,
  ScanTextIcon,
  ScissorsIcon,
  SearchIcon,
  SparklesIcon,
  SquareCheckIcon,
  UsersIcon,
  WrenchIcon,
} from "lucide-react";

const presentations = {
  directory: { title: msg`查看章节目录`, icon: ListTreeIcon },
  search_headings: { title: msg`查找章节标题`, icon: SearchIcon },
  read_context: { title: msg`读取原文上下文`, icon: BookOpenIcon },
  read_analysis: { title: msg`查看已保存的归属`, icon: UsersIcon },
  request_input: { title: msg`向用户提问`, icon: MessageCircleQuestionIcon },
  analyze_chapter: { title: msg`章节分析`, icon: SparklesIcon },
  check_splitting: { title: msg`检查全书分章`, icon: ScissorsIcon },
  cast_voices: { title: msg`工程选角建议`, icon: AudioLinesIcon },
  compare_rules: { title: msg`比较分章规则`, icon: GitCompareIcon },
  finish_splitting: { title: msg`提交候选方案`, icon: SquareCheckIcon },
  propose_characters: { title: msg`提出角色建议`, icon: UsersIcon },
  check_draft: { title: msg`检查归属草稿`, icon: SquareCheckIcon },
  read_source: { title: msg`读取原文片段`, icon: FileTextIcon },
  patch_annotations: { title: msg`调整片段归属`, icon: PencilLineIcon },
  finish_analysis: { title: msg`提交分析结果`, icon: ScanTextIcon },
  finish_casting: { title: msg`提交选角建议`, icon: AudioLinesIcon },
};

export function toolPresentation(name: string): {
  title: MessageDescriptor;
  icon: LucideIcon;
  detail?: string;
} {
  return Object.hasOwn(presentations, name)
    ? presentations[name as keyof typeof presentations]
    : { title: msg`工具调用`, icon: WrenchIcon, detail: name };
}
