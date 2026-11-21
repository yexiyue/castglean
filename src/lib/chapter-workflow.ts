import type { ChapterAudio } from "@/hooks/use-chapter-audio";
import type {
  ChapterAudioRunView_Serialize as AudioRun,
  ChapterAudioBlocker_Serialize as Blocker,
  RunInfo,
} from "@/lib/bindings";
import { hasCompleteAudio } from "@/lib/chapter-audio";

export type AudioTaskTarget = Pick<
  AudioRun,
  "projectId" | "chapterId" | "chapterTitle" | "mode"
>;

export type ChapterWorkflow =
  | { kind: "assistant_task"; run: RunInfo; title: string; elsewhere: boolean }
  | { kind: "audio_return"; target: AudioTaskTarget }
  | { kind: "attribution"; range: NonNullable<Blocker["range"]> }
  | { kind: "voice"; characterId: string | null }
  | { kind: "analysis" | "preflight_failed" | "models" | "voices" };

export function blockerRepair(kind: Blocker["kind"]) {
  switch (kind) {
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
  analysis,
  narratorSelected,
  audio,
  assistant,
  audioReturn,
}: {
  chapterId: string;
  analysis: "loading" | "failed" | "missing" | "ready";
  narratorSelected: boolean;
  audio: ChapterAudio;
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
  if (audio.active) return null;
  if (
    audioReturn &&
    (audioReturn.chapterId !== chapterId || audioReturn.mode !== audio.mode)
  )
    return { kind: "audio_return", target: audioReturn };
  if (audio.readState === "failed") return null;
  if (audio.status && hasCompleteAudio(audio.status) && !audio.restartRequired)
    return null;
  if (audio.mode === "multi_role") {
    if (analysis === "missing") return { kind: "analysis" };
    if (analysis !== "ready") return null;
  } else if (!narratorSelected) return null;

  if (audio.preflight === "failed") return { kind: "preflight_failed" };
  if (audio.preflight === "blocked") {
    const blockers = audio.blockers ?? [];
    if (blockers.some(({ kind }) => blockerRepair(kind) === "analysis"))
      return { kind: "analysis" };
    const attribution = blockers.find(
      ({ kind }) => blockerRepair(kind) === "attribution",
    );
    if (attribution?.range)
      return { kind: "attribution", range: attribution.range };
    const voice = blockers.find(({ kind }) => blockerRepair(kind) === "voice");
    if (voice) return { kind: "voice", characterId: voice.characterId };
    if (blockers.some(({ kind }) => blockerRepair(kind) === "voices"))
      return { kind: "voices" };
    if (blockers.some(({ kind }) => blockerRepair(kind) === "models"))
      return { kind: "models" };
  }
  return null;
}
