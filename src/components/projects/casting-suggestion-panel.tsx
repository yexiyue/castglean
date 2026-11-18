import { Trans } from "@lingui/react/macro";
import { InfoIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
  onAdopted,
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
  onAdopted: () => Promise<void>;
  onDesign: (target: BindingTarget, draft: DesignDraft) => void;
}) {
  const player = useVoicePlayer();
  const [pending, setPending] = useState(false);
  const busy = pending || disabled;
  const [failed, setFailed] = useState(false);
  const adoptionRequest = useRef<Parameters<
    typeof commands.castingAdoptDesign
  > | null>(null);
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
  return (
    <div className="flex flex-col gap-3">
      {suggestion.charactersStale ? (
        <p className="text-warning-foreground text-xs">
          <Trans>角色身份在建议生成后有变化，采用前请核对。</Trans>
        </p>
      ) : null}
      {suggestion.catalogStale ? (
        <p className="text-warning-foreground text-xs">
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
          {entry.profile ? (
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
          ) : null}
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
              return (
                <li
                  key={voiceKey(candidate.voice)}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {candidate.label || voiceLabel(candidate.voice)}
                    {candidate.validity !== "valid" ? (
                      <span className="text-warning-foreground ml-2 text-xs">
                        <Trans>当前目录已缺失</Trans>
                      </span>
                    ) : null}
                    <span className="block text-xs text-muted-foreground">
                      {candidate.reason}
                    </span>
                  </span>
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
                          })
                    }
                  >
                    <Trans>试听</Trans>
                  </Button>
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
                    {bound ? <Trans>当前绑定</Trans> : <Trans>采用绑定</Trans>}
                  </Button>
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
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {designPreview.design?.prompt}
              </p>
              <div className="flex flex-wrap gap-2">
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
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    busy ||
                    suggestion.charactersStale ||
                    (binding?.voice?.kind === "library" &&
                      binding.voice.id === designPreview.candidate?.id)
                  }
                  onClick={() =>
                    void run(async () => {
                      let request = adoptionRequest.current;
                      if (
                        !request ||
                        request[0] !== projectId ||
                        request[1] !== suggestion.runId ||
                        request[2] !== designPreview.id
                      ) {
                        request = [
                          projectId,
                          suggestion.runId,
                          designPreview.id,
                          crypto.randomUUID(),
                          projectRevision,
                          binding?.revision ?? 0,
                        ];
                        adoptionRequest.current = request;
                      }
                      const result = await commands.castingAdoptDesign(
                        ...request,
                      );
                      adoptionRequest.current = null;
                      setSavedWithoutBinding(result.binding.Err !== undefined);
                    })
                  }
                >
                  <Trans>确认入库并绑定</Trans>
                </Button>
              </div>
            </div>
          ) : null}
          {entry.design ? (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              disabled={busy}
              onClick={() =>
                onDesign(target, entry.design ?? { engine: null, prompt: "" })
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
          <Trans>操作未保存，请刷新后重试。已有结果保留。</Trans>
        </p>
      ) : null}
    </div>
  );
}

function voiceKey(voice: VoiceRef): string {
  return voice.kind === "library"
    ? voice.id
    : `${voice.backend}:${voice.model}:${voice.voice}`;
}
