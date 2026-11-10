import { Trans } from "@lingui/react/macro";
import { InfoIcon } from "lucide-react";
import { useState } from "react";
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
  const entry = suggestion.targets.find((item) =>
    sameTarget(item.target, target),
  );
  async function run(fn: () => Promise<unknown>) {
    setPending(true);
    setFailed(false);
    try {
      await fn();
      await onAdopted();
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
        <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <Trans>本次建议未覆盖此目标，可能是生成后身份有变化。</Trans>
          </span>
        </p>
      ) : (
        <>
          {binding?.voice && binding.origin?.origin === "manual" ? (
            <p className="text-muted-foreground text-xs">
              <Trans>已人工绑定，不会自动更换。</Trans>
            </p>
          ) : null}
          {entry.profile ? (
            <div className="flex flex-wrap items-start gap-2">
              <p className="text-muted-foreground min-w-0 flex-1 text-xs leading-5">
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
              const playable = presetPlayable(models, candidate.voice);
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
                    <span className="text-muted-foreground block text-xs">
                      {candidate.reason}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={candidate.validity !== "valid" || !playable}
                    onClick={() =>
                      playVoiceRef({
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
      {failed ? (
        <p role="alert" className="text-destructive text-sm">
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
