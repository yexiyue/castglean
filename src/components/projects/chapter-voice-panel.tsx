import { Trans, useLingui } from "@lingui/react/macro";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useBindingOperations } from "@/hooks/use-binding-operations";
import { useModelResources } from "@/hooks/use-model-resources";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import {
  type BindingStateView_Serialize,
  type BindingTarget,
  type ByteRange,
  type Chapter,
  type Character,
  commands,
  type Segment,
  type VoiceRef,
} from "@/lib/bindings";
import {
  characterDisplayLabel,
  presetPlayable,
  sameTarget,
} from "@/lib/voice-audition";
import {
  ChapterVoiceAuditions,
  useChapterVoiceAudition,
} from "./chapter-voice-auditions";
import { CharacterVoicePicker } from "./character-voice-picker";

interface ChapterVoicePanelProps {
  projectId: string;
  chapter: Chapter;
  characters: Character[];
  segment: Segment | null;
  sourceRange?: ByteRange | null;
  requestedTarget: BindingTarget | null;
  attributionPending: boolean;
}

/** Chapter-local casting. Always query the host revision immediately before writing. */
export function ChapterVoicePanel({
  projectId,
  chapter,
  characters,
  segment,
  sourceRange,
  requestedTarget,
  attributionPending,
}: ChapterVoicePanelProps): JSX.Element {
  const { t } = useLingui();
  const resources = useModelResources();
  const studio = useVoiceStudio();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [openPickerKey, setOpenPickerKey] = useState<string | null>(null);
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
      setOpenPickerKey(null);
      setFailed(false);
      setReading(false);
    }
  }, [latestBinding, operations]);
  let target = requestedTarget;
  if (!target && segment?.attribution.state === "narrator") {
    target = { kind: "narrator" };
  } else if (!target && segment?.attribution.state === "resolved") {
    target = {
      kind: "character",
      character_id: segment.attribution.character_id,
    };
  }
  const requestedKey = requestedTarget
    ? requestedTarget.kind === "character"
      ? requestedTarget.character_id
      : "narrator"
    : null;
  useEffect(() => {
    if (!requestedKey) return;
    setEditingKey(requestedKey);
    const frame = requestAnimationFrame(() => setOpenPickerKey(requestedKey));
    return () => cancelAnimationFrame(frame);
  }, [requestedKey]);

  const bindingsKnown = !reading && !failed;
  const binding =
    target && bindingsKnown
      ? bindings.find((entry) => sameTarget(entry.target, target))
      : undefined;
  const key = target?.kind === "character" ? target.character_id : "narrator";
  const pickerOpen = openPickerKey === key;
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
  const readyTarget = bindingsKnown && !attributionPending ? target : null;
  const canBind = readyTarget?.kind === "character";
  const needsVoice = !voice || binding?.validity !== "valid";
  const showPicker =
    canBind && (needsVoice || editingKey === key || pickerOpen);
  const showVoiceActions =
    readyTarget &&
    !needsVoice &&
    !showPicker &&
    (canBind || voice?.kind === "preset");
  const audition = useChapterVoiceAudition({
    projectId,
    chapter,
    key,
    sourceRange: sourceRange ?? segment?.range,
    studio,
    models: resources.entries,
  });
  const bind = (choice: VoiceRef) => {
    if (canBind)
      void operations.start(readyTarget, { type: "bind", voice: choice });
  };
  return (
    <section
      className="flex min-w-0 flex-col gap-3"
      aria-label={t`本章声音设置`}
    >
      {!requestedTarget && (
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
      )}
      {!target && !attributionPending && (
        <p className="text-sm text-muted-foreground">
          <Trans>确定说话人后可设置声音。</Trans>
        </p>
      )}
      {readyTarget && (!requestedTarget || voice) && (
        <p
          className="text-sm wrap-anywhere text-muted-foreground"
          role="status"
        >
          {voiceName ?? t`未绑定`}
          {model && ` · ${model.name}`}
        </p>
      )}
      {readyTarget && voice && needsVoice && (
        <p className="text-xs text-muted-foreground">
          <Trans>当前绑定的音色不可用。</Trans>
        </p>
      )}
      {showVoiceActions && (
        <div className="flex flex-wrap items-center gap-2">
          {voice?.kind === "preset" && (
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy ||
                audition.reading ||
                studio.pending ||
                resources.loading ||
                !!resources.error ||
                !presetPlayable(resources.entries, voice)
              }
              onClick={() => void audition.generate(voice)}
            >
              <Trans comment="合成一段用于试听的声音">生成试听</Trans>
            </Button>
          )}
          {canBind && (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              disabled={busy}
              onClick={() => {
                setEditingKey(key);
                setOpenPickerKey(key);
              }}
            >
              <Trans>更换音色</Trans>
            </Button>
          )}
        </div>
      )}
      {showPicker && (
        <CharacterVoicePicker
          key={key}
          libraryVoices={[]}
          models={resources.error || resources.loading ? [] : resources.entries}
          busy={
            busy ||
            audition.reading ||
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
          onAudition={(choice) => void audition.generate(choice)}
          open={pickerOpen}
          onOpenChange={(open) => setOpenPickerKey(open ? key : null)}
          production
        />
      )}
      <ChapterVoiceAuditions
        studio={studio}
        models={resources.entries}
        audition={audition}
        visible={!!target && !attributionPending}
        busy={busy}
        voice={voice}
        bind={canBind ? bind : undefined}
      />
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
