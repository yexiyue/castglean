import { Trans, useLingui } from "@lingui/react/macro";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { StudioJobs } from "@/components/voices/studio-jobs";
import { useBindingOperations } from "@/hooks/use-binding-operations";
import { useModelResources } from "@/hooks/use-model-resources";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import {
  type BindingStateView_Serialize,
  type BindingTarget,
  type Character,
  commands,
  type Segment,
  type VoiceRef,
} from "@/lib/bindings";
import { characterDisplayLabel, sameTarget } from "@/lib/voice-audition";
import { CharacterVoicePicker } from "./character-voice-picker";

interface ChapterVoicePanelProps {
  projectId: string;
  characters: Character[];
  segment: Segment | null;
  requestedTarget: BindingTarget | null;
}

/** Chapter-local casting. Always query the host revision immediately before writing. */
export function ChapterVoicePanel({
  projectId,
  characters,
  segment,
  requestedTarget,
}: ChapterVoicePanelProps): JSX.Element {
  const { t } = useLingui();
  const resources = useModelResources();
  const studio = useVoiceStudio();
  const [target, setTarget] = useState<BindingTarget>({ kind: "narrator" });
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
      setFailed(false);
      setReading(false);
    }
  }, [latestBinding, operations]);
  useEffect(() => {
    if (requestedTarget) setTarget(requestedTarget);
  }, [requestedTarget]);
  useEffect(() => {
    if (segment?.attribution.state === "resolved")
      setTarget({
        kind: "character",
        character_id: segment.attribution.character_id,
      });
    else if (segment?.attribution.state === "narrator")
      setTarget({ kind: "narrator" });
  }, [segment?.attribution]);
  const bindingsKnown = !reading && !failed;
  const binding = bindingsKnown
    ? bindings.find((b) => sameTarget(b.target, target))
    : undefined;
  const key = target.kind === "narrator" ? "narrator" : target.character_id;
  const targetLabel =
    target.kind === "narrator"
      ? t`旁白`
      : characterDisplayLabel(characters, target.character_id, t`未知角色`);
  async function bind(voice: VoiceRef) {
    await operations.start(target, { type: "bind", voice });
  }
  return (
    <section
      className="flex flex-col gap-3 border-t pt-3"
      aria-label={t`本章声音设置`}
    >
      <h3 className="text-sm font-medium">
        <Trans comment="章节右侧的角色声音属性">声音</Trans>
      </h3>
      <NativeSelect
        aria-label={t`选择配音角色`}
        value={key}
        disabled={busy || !bindingsKnown}
        onChange={(e) =>
          setTarget(
            e.target.value === "narrator"
              ? { kind: "narrator" }
              : { kind: "character", character_id: e.target.value },
          )
        }
      >
        <option value="narrator">
          {t`旁白`}
          {!bindingsKnown ||
          bindings.some((b) => b.target.kind === "narrator" && b.voice)
            ? ""
            : ` · ${t`未绑定`}`}
        </option>
        {characters.map((c) => (
          <option key={c.id} value={c.id}>
            {characterDisplayLabel(characters, c.id, t`未知角色`)}
            {!bindingsKnown ||
            bindings.some(
              (b) =>
                b.target.kind === "character" &&
                b.target.character_id === c.id &&
                b.voice,
            )
              ? ""
              : ` · ${t`未绑定`}`}
          </option>
        ))}
      </NativeSelect>
      {binding?.voice && (
        <p className="text-muted-foreground text-xs" role="status">
          {binding.voice.kind === "preset"
            ? `${binding.voice.model} / ${binding.voice.voice}`
            : binding.voice.id}
        </p>
      )}
      {bindingsKnown && (
        <CharacterVoicePicker
          key={key}
          libraryVoices={[]}
          models={resources.error || resources.loading ? [] : resources.entries}
          busy={
            busy || studio.pending || resources.loading || !!resources.error
          }
          studio={studio}
          current={binding?.voice ?? null}
          targetLabel={targetLabel}
          workspaceId={projectId}
          targetKey={key}
          modelsLoading={resources.loading}
          modelsError={!!resources.error}
          onModelsRetry={() => void resources.refresh()}
          onPick={(voice) => void bind(voice)}
          production
        />
      )}
      {operations.operation?.busy && (
        <p role="status" className="text-muted-foreground text-xs">
          <Trans>正在保存…</Trans>
        </p>
      )}
      {reading && (
        <p role="status" className="text-muted-foreground text-xs">
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
        <p role="alert" className="text-destructive text-xs">
          <Trans>未能确认声音设置，请重新读取后核对。</Trans>
        </p>
      )}
      <StudioJobs studio={studio} />
    </section>
  );
}
