import { Trans, useLingui } from "@lingui/react/macro";
import { InfoIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineVoicePreview } from "@/components/voices/inline-voice-preview";
import { StudioJobs } from "@/components/voices/studio-jobs";
import { useVoicePlayer } from "@/components/voices/voice-player";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import type { ModelEntry } from "@/lib/bindings";
import {
  type BindingStateView_Serialize,
  type BindingTarget,
  commands,
  type DesignDraft,
  type ProfileView_Serialize,
  type SuggestionView_Serialize,
  type VoiceRef,
} from "@/lib/bindings";
import { useWorkspaceState } from "@/lib/desktop-session";
import {
  playVoiceRef,
  presetPlayable,
  sameTarget,
  sameVoice,
  voiceLabel,
} from "@/lib/voice-audition";

/**
 * Per-target casting suggestion comparison: the current binding and the
 * suggestion live in one view; adoption stays per item and explicit.
 */
export function CastingSuggestionPanel({
  projectId,
  projectRevision,
  target,
  suggestion,
  binding,
  profile,
  models,
  studio,
  disabled = false,
  inline = false,
  onAdopted,
  onRefresh = onAdopted,
  onDesign,
}: {
  projectId: string;
  /** 工程修订：采用命令的期望修订。 */
  projectRevision: number;
  target: BindingTarget;
  suggestion: SuggestionView_Serialize;
  binding: BindingStateView_Serialize | null;
  profile: ProfileView_Serialize | null;
  models: ModelEntry[];
  studio: VoiceStudio;
  disabled?: boolean;
  inline?: boolean;
  onAdopted: () => Promise<void>;
  onRefresh?: () => Promise<void>;
  onDesign?: (target: BindingTarget, draft: DesignDraft) => void;
}) {
  const { t } = useLingui();
  const player = useVoicePlayer();
  const [pending, setPending] = useState(false);
  const busy = pending || disabled;
  const [failed, setFailed] = useState(false);
  const [adoptionRequest, setAdoptionRequest] = useWorkspaceState<Parameters<
    typeof commands.castingAdoptDesign
  > | null>(
    projectId,
    JSON.stringify(["casting-adopt-design", suggestion.runId, target]),
    null,
  );
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [savedWithoutBinding, setSavedWithoutBinding] = useState(false);
  const preview = suggestion.previews?.find((item) =>
    sameTarget(item.target, target),
  );
  const designPreview = preview?.design ? preview : undefined;
  function playPreview(id: string, label: string) {
    void studio.run(async () => {
      const audio = await commands.castingPreviewAudio(
        projectId,
        suggestion.runId,
        id,
      );
      await player.play(audio, label);
    });
  }
  const entry = suggestion.targets.find((item) =>
    sameTarget(item.target, target),
  );
  async function run(fn: () => Promise<unknown>) {
    setPending(true);
    setFailed(false);
    setRefreshFailed(false);
    try {
      await fn();
      try {
        await onAdopted();
      } catch {
        setRefreshFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }
  async function refreshResult() {
    setPending(true);
    try {
      await onRefresh();
      setFailed(false);
      setRefreshFailed(false);
    } catch {
      if (!failed) setRefreshFailed(true);
    } finally {
      setPending(false);
    }
  }
  const profileDetails = entry?.profile ? (
    <div className="flex flex-wrap items-start gap-2">
      <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
        {entry.profile}
        {profile?.text ? (
          <span className="block">
            <Trans>当前画像：{profile.text}</Trans>
          </span>
        ) : null}
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() =>
          void run(() =>
            commands.voiceBindingAdoptProfile(
              projectId,
              suggestion.runId,
              target,
              crypto.randomUUID(),
              projectRevision,
              profile?.revision ?? 0,
            ),
          )
        }
      >
        <Trans>采用画像</Trans>
      </Button>
    </div>
  ) : null;
  return (
    <div className="flex flex-col gap-3">
      {suggestion.charactersStale ? (
        <p className="text-xs text-warning-foreground">
          <Trans>角色身份在建议生成后有变化，采用前请核对。</Trans>
        </p>
      ) : null}
      {suggestion.catalogStale ? (
        <p className="text-xs text-warning-foreground">
          <Trans>音色目录在建议生成后有变化，缺失条目已标注。</Trans>
        </p>
      ) : null}
      {!entry ? (
        <p className="flex items-start gap-1 text-xs text-muted-foreground">
          <InfoIcon className="mt-1 size-3.5 shrink-0" />
          <span>
            <Trans>本次建议未覆盖此目标，可能是生成后身份有变化。</Trans>
          </span>
        </p>
      ) : (
        <>
          {binding?.voice && binding.origin?.origin === "manual" ? (
            <p className="text-xs text-muted-foreground">
              <Trans>已人工绑定，不会自动更换。</Trans>
            </p>
          ) : null}
          {!inline && profileDetails}
          <ul className="flex flex-col gap-1">
            {entry.voiceCandidates.map((candidate) => {
              const audio =
                preview?.voice && sameVoice(preview.voice, candidate.voice)
                  ? preview
                  : undefined;
              const playable = audio
                ? audio.status === "available"
                : presetPlayable(models, candidate.voice);
              const bound = binding?.voice
                ? sameVoice(binding.voice, candidate.voice)
                : false;
              const auditionScope = JSON.stringify([
                "casting-suggestion",
                projectId,
                suggestion.runId,
                target,
                voiceKey(candidate.voice),
              ]);
              return (
                <li
                  key={voiceKey(candidate.voice)}
                  className="flex min-w-0 flex-col gap-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {candidate.label || voiceLabel(candidate.voice)}
                      {candidate.validity !== "valid" ? (
                        <span className="ml-2 text-xs text-warning-foreground">
                          <Trans>当前目录已缺失</Trans>
                        </span>
                      ) : null}
                      <span className="block text-xs text-muted-foreground">
                        {candidate.reason}
                      </span>
                    </span>
                    {inline && (audio || candidate.voice.kind === "library") ? (
                      <InlineVoicePreview
                        label={t`试听`}
                        name={candidate.label || voiceLabel(candidate.voice)}
                        disabled={candidate.validity !== "valid" || !playable}
                        loadAudio={() =>
                          audio
                            ? commands.castingPreviewAudio(
                                projectId,
                                suggestion.runId,
                                audio.id,
                              )
                            : candidate.voice.kind === "library"
                              ? commands.voiceReferenceAudio(candidate.voice.id)
                              : Promise.reject(new Error("missing_preview"))
                        }
                      />
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={candidate.validity !== "valid" || !playable}
                        onClick={() =>
                          audio
                            ? playPreview(audio.id, candidate.label)
                            : playVoiceRef({
                                voice: candidate.voice,
                                studio,
                                player,
                                models,
                                scope: auditionScope,
                              })
                        }
                      >
                        <Trans>试听</Trans>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || candidate.validity !== "valid" || bound}
                      onClick={() =>
                        void run(() =>
                          commands.voiceBindingAdoptBinding(
                            projectId,
                            suggestion.runId,
                            target,
                            candidate.voice,
                            crypto.randomUUID(),
                            projectRevision,
                            binding?.revision ?? 0,
                          ),
                        )
                      }
                    >
                      {bound ? (
                        <Trans>当前绑定</Trans>
                      ) : (
                        <Trans>采用绑定</Trans>
                      )}
                    </Button>
                  </div>
                  <StudioJobs
                    studio={studio}
                    scope={auditionScope}
                    models={models}
                    inline={inline}
                  />
                </li>
              );
            })}
          </ul>
          {preview && preview.status !== "available" ? (
            <p role="status" className="text-xs text-muted-foreground">
              {preview.status === "unapproved" ? (
                <Trans>尚未批准此试听。</Trans>
              ) : (
                <Trans>试听音频当前不可用。</Trans>
              )}
            </p>
          ) : null}
          {designPreview?.status === "available" && designPreview.candidate ? (
            <section
              data-slot="casting-generated-preview"
              className="space-y-1.5 border-t border-border/60 pt-2"
            >
              {inline && (
                <p className="text-sm font-medium wrap-anywhere">
                  {designPreview.candidate.name}
                </p>
              )}
              {designPreview.design?.prompt && (
                <p
                  className="line-clamp-2 text-xs text-muted-foreground"
                  title={designPreview.design.prompt}
                >
                  {designPreview.design.prompt}
                </p>
              )}
              <div className="flex flex-wrap items-start gap-1">
                {inline ? (
                  <InlineVoicePreview
                    label={t`试听设计候选`}
                    name={designPreview.candidate.name}
                    loadAudio={() =>
                      commands.castingPreviewAudio(
                        projectId,
                        suggestion.runId,
                        designPreview.id,
                      )
                    }
                  />
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      playPreview(
                        designPreview.id,
                        designPreview.candidate?.name ?? "",
                      )
                    }
                  >
                    <Trans>试听设计候选</Trans>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    busy ||
                    suggestion.charactersStale ||
                    (binding?.voice?.kind === "library" &&
                      binding.voice.id === designPreview.candidate?.id)
                  }
                  onClick={() =>
                    void run(async () => {
                      let request = adoptionRequest;
                      if (!request || request[2] !== designPreview.id) {
                        request = [
                          projectId,
                          suggestion.runId,
                          designPreview.id,
                          crypto.randomUUID(),
                          projectRevision,
                          binding?.revision ?? 0,
                        ];
                        setAdoptionRequest(request);
                      }
                      try {
                        const result = await commands.castingAdoptDesign(
                          ...request,
                        );
                        setAdoptionRequest(null);
                        setSavedWithoutBinding(
                          result.binding.Err !== undefined,
                        );
                      } catch (error) {
                        if (error === "conflict" || error === "not_found")
                          setAdoptionRequest(null);
                        throw error;
                      }
                    })
                  }
                >
                  {binding?.voice?.kind === "library" &&
                  binding.voice.id === designPreview.candidate.id ? (
                    <Trans>当前绑定</Trans>
                  ) : adoptionRequest && !pending ? (
                    <Trans>重试原操作</Trans>
                  ) : (
                    <Trans>确认入库并绑定</Trans>
                  )}
                </Button>
              </div>
            </section>
          ) : null}
          {inline && profileDetails}
          {entry.design && onDesign ? (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              disabled={busy}
              onClick={() =>
                onDesign?.(target, entry.design ?? { engine: null, prompt: "" })
              }
            >
              <Trans>目录中没有合适的，编辑设计草稿</Trans>
            </Button>
          ) : null}
        </>
      )}
      {savedWithoutBinding ? (
        <p role="alert" className="text-sm text-destructive">
          <Trans>音色已入库，绑定未保存。请核对当前绑定后再次确认。</Trans>
        </p>
      ) : null}
      {refreshFailed ? (
        <p role="alert" className="text-sm text-destructive">
          <Trans>操作已保存，结果读取失败。</Trans>
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {adoptionRequest ? (
            <Trans>上次音色修改的结果尚未确认。重试会使用原操作身份。</Trans>
          ) : (
            <Trans>操作未保存，请刷新后重试。已有结果保留。</Trans>
          )}
        </p>
      ) : null}
      {(failed || refreshFailed) && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          disabled={busy}
          onClick={() => void refreshResult()}
        >
          <Trans>重新读取结果</Trans>
        </Button>
      )}
    </div>
  );
}

function voiceKey(voice: VoiceRef): string {
  return voice.kind === "library"
    ? voice.id
    : `${voice.backend}:${voice.model}:${voice.voice}`;
}
