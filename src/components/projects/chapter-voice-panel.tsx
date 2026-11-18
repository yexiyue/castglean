import { Trans, useLingui } from "@lingui/react/macro";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { StudioJobFeedback } from "@/components/voices/studio-job-feedback";
import { useVoicePlayer } from "@/components/voices/voice-player";
import { useBindingOperations } from "@/hooks/use-binding-operations";
import { useModelResources } from "@/hooks/use-model-resources";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import {
  type BindingStateView_Serialize,
  type BindingTarget,
  type Chapter,
  type Character,
  commands,
  type Segment,
  type VoiceRef,
} from "@/lib/bindings";
import {
  characterDisplayLabel,
  playVoiceRef,
  presetPlayable,
  sameTarget,
  sameVoice,
} from "@/lib/voice-audition";
import { CharacterVoicePicker } from "./character-voice-picker";

interface ChapterVoicePanelProps {
  projectId: string;
  chapter: Chapter;
  characters: Character[];
  segment: Segment | null;
  requestedTarget: BindingTarget | null;
  attributionPending: boolean;
}

/** Chapter-local casting. Always query the host revision immediately before writing. */
export function ChapterVoicePanel({
  projectId,
  chapter,
  characters,
  segment,
  requestedTarget,
  attributionPending,
}: ChapterVoicePanelProps): JSX.Element {
  const { t } = useLingui();
  const resources = useModelResources();
  const studio = useVoiceStudio();
  const player = useVoicePlayer();
  const readingAudition = useRef(false);
  const [auditionReading, setAuditionReading] = useState(false);
  const [auditionReadFailed, setAuditionReadFailed] = useState<string | null>(
    null,
  );
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bindings, setBindings] = useState<BindingStateView_Serialize[]>([]);
  const operations = useBindingOperations(projectId);
  const busy =
    !!operations.operation ||
    !!operations.profileOperation ||
    !!operations.identityOperation;
  const latestBinding = operations.latest;
  const [failed, setFailed] = useState(false);
  const [reading, setReading] = useState(true);
  const alive = useRef(true);
  const readSequence = useRef(0);
  const seenCompletion = useRef(operations.completion);
  const refresh = useCallback(async () => {
    const generation = operations.completion;
    const sequence = ++readSequence.current;
    setReading(true);
    try {
      const next = await commands.voiceBindingBindings(projectId);
      if (
        alive.current &&
        sequence === readSequence.current &&
        generation === operations.completion
      ) {
        setBindings(next);
        setFailed(false);
        setReading(false);
      }
    } catch {
      if (
        alive.current &&
        sequence === readSequence.current &&
        generation === operations.completion
      ) {
        setFailed(true);
        setReading(false);
      }
    }
  }, [projectId, operations]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      readSequence.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (latestBinding && operations.completion !== seenCompletion.current) {
      seenCompletion.current = operations.completion;
      setBindings(latestBinding.bindings);
      setEditingKey(null);
      setPickerOpen(false);
      setFailed(false);
      setReading(false);
    }
  }, [latestBinding, operations]);
  let target = requestedTarget;
  if (!target && (!segment || segment.attribution.state === "narrator")) {
    target = { kind: "narrator" };
  } else if (!target && segment?.attribution.state === "resolved") {
    target = {
      kind: "character",
      character_id: segment.attribution.character_id,
    };
  }
  useEffect(() => {
    if (!requestedTarget) {
      setPickerOpen(false);
      return;
    }
    setEditingKey(
      requestedTarget.kind === "character"
        ? requestedTarget.character_id
        : "narrator",
    );
    const frame = requestAnimationFrame(() => setPickerOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [requestedTarget]);

  const bindingsKnown = !reading && !failed;
  const binding =
    target && bindingsKnown
      ? bindings.find((entry) => sameTarget(entry.target, target))
      : undefined;
  const key = target?.kind === "character" ? target.character_id : "narrator";
  const targetLabel =
    target?.kind === "character"
      ? characterDisplayLabel(characters, target.character_id, t`未知角色`)
      : t`旁白`;
  const voice = binding?.voice;
  const model =
    voice?.kind === "preset"
      ? resources.entries.find(
          (entry) =>
            entry.backend === voice.backend && entry.model === voice.model,
        )
      : undefined;
  const voiceName =
    voice?.kind === "preset"
      ? (model?.voice_catalog.find((item) => item.id === voice.voice)?.name ??
        voice.voice)
      : voice?.id;
  const editableTarget = bindingsKnown && !attributionPending ? target : null;
  const needsVoice = !voice || binding?.validity !== "valid";
  const auditionScope = JSON.stringify([projectId, key]);
  const auditions =
    target && !attributionPending
      ? studio.jobs.filter(
          (job) => studio.scopeForJob(job.id) === auditionScope,
        )
      : [];
  const bind = (choice: VoiceRef) => {
    if (editableTarget)
      void operations.start(editableTarget, { type: "bind", voice: choice });
  };
  async function generateAudition(choice: VoiceRef) {
    if (readingAudition.current || choice.kind !== "preset") return;
    readingAudition.current = true;
    setAuditionReading(true);
    setAuditionReadFailed(null);
    try {
      const excerpt = await commands.chapterAnalysisExcerpt(
        projectId,
        chapter.id,
        segment?.range ?? { start: chapter.start, end: chapter.end },
      );
      const text = Array.from(excerpt.text.trim()).slice(0, 500).join("");
      if (!text || text.includes("\0")) {
        setAuditionReadFailed(auditionScope);
        return;
      }
      playVoiceRef({
        voice: choice,
        studio,
        player,
        models: resources.entries,
        scope: auditionScope,
        text,
      });
    } catch {
      setAuditionReadFailed(auditionScope);
    } finally {
      readingAudition.current = false;
      setAuditionReading(false);
    }
  }
  return (
    <section
      className="flex min-w-0 flex-col gap-3"
      aria-label={t`本章声音设置`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">
          <Trans comment="章节右侧的角色声音属性">声音</Trans>
        </h3>
        {target && !attributionPending && (
          <span className="text-xs wrap-anywhere text-muted-foreground">
            {targetLabel}
          </span>
        )}
      </div>
      {!target && !attributionPending && (
        <p className="text-sm text-muted-foreground">
          <Trans>确定说话人后可设置声音。</Trans>
        </p>
      )}
      {editableTarget && (
        <p
          className="text-sm wrap-anywhere text-muted-foreground"
          role="status"
        >
          {voiceName ?? t`未绑定`}
          {model && ` · ${model.name}`}
        </p>
      )}
      {editableTarget && voice && needsVoice && (
        <p className="text-xs text-muted-foreground">
          <Trans>当前绑定的音色不可用。</Trans>
        </p>
      )}
      {editableTarget && !needsVoice && editingKey !== key && !pickerOpen && (
        <div className="flex flex-wrap items-center gap-2">
          {voice?.kind === "preset" && (
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy ||
                auditionReading ||
                studio.pending ||
                resources.loading ||
                !!resources.error ||
                !presetPlayable(resources.entries, voice)
              }
              onClick={() => void generateAudition(voice)}
            >
              <Trans comment="合成一段用于试听的声音">生成试听</Trans>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            disabled={busy}
            onClick={() => {
              setEditingKey(key);
              setPickerOpen(true);
            }}
          >
            <Trans>更换音色</Trans>
          </Button>
        </div>
      )}
      {editableTarget && (needsVoice || editingKey === key || pickerOpen) && (
        <CharacterVoicePicker
          key={key}
          libraryVoices={[]}
          models={resources.error || resources.loading ? [] : resources.entries}
          busy={
            busy ||
            auditionReading ||
            studio.pending ||
            resources.loading ||
            !!resources.error
          }
          studio={studio}
          current={voice ?? null}
          targetLabel={targetLabel}
          workspaceId={projectId}
          targetKey={key}
          modelsLoading={resources.loading}
          modelsError={!!resources.error}
          onModelsRetry={() => void resources.refresh()}
          onPick={bind}
          onAudition={(choice) => void generateAudition(choice)}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          production
        />
      )}
      {auditionReadFailed === auditionScope && (
        <p role="alert" className="text-xs text-destructive">
          <Trans>无法读取可用于试听的原文。</Trans>
        </p>
      )}
      {auditions.length > 0 && (
        <div className="flex min-w-0 flex-col gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            <Trans>试听记录</Trans>
          </h4>
          {studio.error && (
            <p role="alert" className="text-xs text-destructive">
              <Trans>音色操作未完成</Trans>
            </p>
          )}
          {[...auditions].reverse().map((job) => {
            const { request } = job;
            if (request.kind !== "audition" || request.voice.kind !== "preset")
              return null;
            const presetId = request.voice.voice;
            const model = resources.entries.find(
              (entry) =>
                entry.backend === request.backend &&
                entry.model === request.model,
            );
            const name =
              model?.voice_catalog.find((entry) => entry.id === presetId)
                ?.name ?? presetId;
            const choice: VoiceRef = {
              kind: "preset",
              backend: request.backend,
              model: request.model,
              voice: presetId,
            };
            return (
              <StudioJobFeedback
                key={job.id}
                job={job}
                busy={busy || studio.pending}
                compact={{
                  name,
                  model: model?.name ?? request.model,
                  playing: !!job.audio && player.playingId === job.audio,
                  onBind:
                    editableTarget && (!voice || !sameVoice(voice, choice))
                      ? () => bind(choice)
                      : undefined,
                }}
                onPlay={() => {
                  if (job.audio)
                    void player.toggle(job.audio, name, request.text);
                }}
                onCancel={() =>
                  void studio.run(() => commands.cancelVoiceJob(job.id))
                }
                onRetry={() => void studio.start(request, null, auditionScope)}
                onDismiss={() =>
                  void studio.run(async () => {
                    if (job.audio) await player.stop();
                    await commands.dismissVoiceJob(job.id);
                  })
                }
              />
            );
          })}
        </div>
      )}
      {operations.operation?.busy && (
        <p role="status" className="text-xs text-muted-foreground">
          <Trans>正在保存…</Trans>
        </p>
      )}
      {reading && (
        <p role="status" className="text-xs text-muted-foreground">
          <Trans>正在读取声音设置…</Trans>
        </p>
      )}
      {failed && (
        <Button
          variant="outline"
          size="sm"
          disabled={reading}
          onClick={() => void refresh()}
        >
          <Trans>重新读取声音设置</Trans>
        </Button>
      )}
      {failed && (
        <p role="alert" className="text-xs text-destructive">
          <Trans>未能确认声音设置，请重新读取后核对。</Trans>
        </p>
      )}
    </section>
  );
}
