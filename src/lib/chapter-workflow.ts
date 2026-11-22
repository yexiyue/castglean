import type {
  ChapterAudioRunView_Serialize as AudioRun,
  ChapterAudioBlocker_Serialize as Blocker,
  RunInfo,
} from "@/lib/bindings";

export type AudioTaskTarget = Pick<
  AudioRun,
  "projectId" | "chapterId" | "chapterTitle" | "mode"
>;

export type ChapterWorkflow =
  | { kind: "assistant_task"; run: RunInfo; title: string; elsewhere: boolean }
  | { kind: "audio_return"; target: AudioTaskTarget };

export function blockerRepair(kind: Blocker["kind"]) {
  switch (kind) {
    case "unassigned_attribution":
    case "unknown_attribution":
    case "ambiguous_attribution":
      return "attribution";
    case "missing_binding":
    case "voice_missing":
    case "voice_not_preset":
      return "voice";
    case "no_analysis":
    case "analysis_invalid":
      return "analysis";
    case "mixed_combos":
      return "voices";
    case "resource_not_ready":
      return "models";
  }
}

export function chapterWorkflow({
  chapterId,
  mode,
  audioActive,
  assistant,
  audioReturn,
}: {
  chapterId: string;
  mode: AudioTaskTarget["mode"];
  audioActive: boolean;
  audioReturn: AudioTaskTarget | null;
  assistant: { run: RunInfo; title: string; chapterId: string } | null;
}): ChapterWorkflow | null {
  if (assistant)
    return {
      kind: "assistant_task",
      run: assistant.run,
      title: assistant.title,
      elsewhere: assistant.chapterId !== chapterId,
    };
  if (audioActive) return null;
  if (
    audioReturn &&
    (audioReturn.chapterId !== chapterId || audioReturn.mode !== mode)
  )
    return { kind: "audio_return", target: audioReturn };
  return null;
}
