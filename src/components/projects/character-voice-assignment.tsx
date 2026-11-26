import { Trans, useLingui } from "@lingui/react/macro";
import { AudioLinesIcon, BarChart3Icon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { StudioJobs } from "@/components/voices/studio-jobs";
import { useVoicePlayer } from "@/components/voices/voice-player";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import {
  type BindingStateView_Serialize,
  type BindingTarget,
  type Chapter_Serialize,
  commands,
  type LibraryVoice,
  type ModelEntry,
  type TargetUsageView,
  type VoiceRef,
} from "@/lib/bindings";
import { cn } from "@/lib/utils";
import { playVoiceRef, presetPlayable } from "@/lib/voice-audition";
import { CharacterDetailSection as Section } from "./character-detail-section";
import { CharacterVoicePicker } from "./character-voice-picker";

export function CharacterVoiceAssignment({
  projectId,
  target,
  title,
  binding,
  chapters,
  studio,
  models,
  voiceName,
  libraryVoices,
  modelsLoading,
  modelsError,
  onModelsRetry,
  busy,
  onError,
  onBindVoice,
  onDesign,
  designSlot,
}: {
  projectId: string;
  target: BindingTarget;
  title: string;
  binding: BindingStateView_Serialize | null;
  chapters: Chapter_Serialize[];
  studio: VoiceStudio;
  models: ModelEntry[];
  voiceName: (voice: VoiceRef) => string;
  libraryVoices: LibraryVoice[];
  modelsLoading: boolean;
  modelsError: boolean;
  onModelsRetry: () => void;
  busy: boolean;
  onError: () => void;
  onBindVoice: (target: BindingTarget, voice: VoiceRef | null) => void;
  onDesign: (target: BindingTarget) => void;
  designSlot: ReactNode;
}) {
  const { t } = useLingui();
  const [usage, setUsage] = useState<TargetUsageView | null>(null);
  const voice = binding?.voice ?? null;
  const invalid = voice && binding?.validity && binding.validity !== "valid";
  const player = useVoicePlayer();
  const canAuditionBound = !!voice && !invalid && presetPlayable(models, voice);
  const targetKey =
    target.kind === "narrator" ? "narrator" : target.character_id;
  const boundAuditionScope = JSON.stringify([
    "character-bound",
    projectId,
    targetKey,
    voice,
  ]);
  const designScope = JSON.stringify(["character-design", projectId, target]);
  const catalogBlock = (
    <CharacterVoicePicker
      key={targetKey}
      libraryVoices={libraryVoices}
      models={models}
      busy={busy || modelsLoading}
      studio={studio}
      current={voice ?? null}
      targetLabel={title}
      workspaceId={projectId}
      targetKey={targetKey}
      modelsLoading={modelsLoading}
      modelsError={modelsError}
      onModelsRetry={onModelsRetry}
      secondaryAction={
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => onDesign(target)}
        >
          <Trans>设计新音色</Trans>
        </Button>
      }
      onPick={(picked) => onBindVoice(target, picked)}
    />
  );

  return (
    <Section title={t`音色`}>
      {voice ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <AudioLinesIcon className="size-4 shrink-0 text-muted-foreground" />
              <span
                className={cn(
                  "truncate text-sm font-medium",
                  invalid && "text-destructive",
                )}
              >
                {invalid ? (
                  <Trans>绑定音色已失效（目录缺失）</Trans>
                ) : (
                  voiceName(voice)
                )}
              </span>
              {binding?.origin?.origin === "suggestion" ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  <Trans>来自建议</Trans>
                </span>
              ) : null}
            </div>
            {!invalid && binding?.origin?.origin === "manual" && (
              <p className="text-xs text-muted-foreground">
                <Trans>人工绑定 · 不会自动更换</Trans>
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t`使用统计`}
                    title={t`使用统计`}
                    disabled={busy}
                    onClick={() =>
                      void commands
                        .voiceBindingUsage(projectId, target)
                        .then(setUsage)
                        .catch(onError)
                    }
                  />
                }
              >
                <BarChart3Icon className="size-4" />
              </PopoverTrigger>
              <PopoverContent align="end" className="max-h-64 overflow-y-auto">
                {usage ? (
                  <div className="text-xs">
                    <p className="pb-1 text-muted-foreground">
                      <Trans>共 {usage.totalSegments} 处</Trans>
                    </p>
                    {usage.chapters.map((chapter) => (
                      <p key={chapter.chapterId}>
                        {chapters.find((c) => c.id === chapter.chapterId)
                          ?.title ?? chapter.chapterId}{" "}
                        · {chapter.segmentIds.length}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    <Trans>读取中…</Trans>
                  </p>
                )}
              </PopoverContent>
            </Popover>
            <Button
              size="sm"
              variant={canAuditionBound ? "default" : "outline"}
              disabled={busy || !canAuditionBound}
              onClick={() =>
                playVoiceRef({
                  voice,
                  studio,
                  player,
                  models,
                  scope: boundAuditionScope,
                })
              }
            >
              <Trans>试听</Trans>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onBindVoice(target, null)}
            >
              <Trans comment="Remove this narration or character voice assignment.">
                解绑
              </Trans>
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          <Trans>未绑定</Trans>
        </p>
      )}
      {voice?.kind === "preset" && (
        <StudioJobs
          studio={studio}
          scope={boundAuditionScope}
          models={models}
        />
      )}
      {catalogBlock}
      <StudioJobs studio={studio} scope={designScope} />
      {designSlot}
    </Section>
  );
}
