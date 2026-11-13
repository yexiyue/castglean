import { Trans, useLingui } from "@lingui/react/macro";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { StudioJobs } from "@/components/voices/studio-jobs";
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
import { sameTarget } from "@/lib/voice-audition";
import { CharacterVoicePicker } from "./character-voice-picker";

interface ChapterVoicePanelProps {
  projectId: string;
  characters: Character[];
  segment: Segment | null;
  requestedTarget: BindingTarget | null;
  onSaved: () => Promise<void>;
}

/** Chapter-local casting. Always query the host revision immediately before writing. */
export function ChapterVoicePanel({
  projectId,
  characters,
  segment,
  requestedTarget,
  onSaved,
}: ChapterVoicePanelProps): JSX.Element {
  const { t } = useLingui();
  const resources = useModelResources();
  const studio = useVoiceStudio();
  const [target, setTarget] = useState<BindingTarget>({ kind: "narrator" });
  const [bindings, setBindings] = useState<BindingStateView_Serialize[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    const next = await commands.voiceBindingBindings(projectId);
    if (alive.current) setBindings(next);
  }, [projectId]);
  useEffect(() => {
    alive.current = true;
    void refresh().catch(() => setFailed(true));
    return () => {
      alive.current = false;
    };
  }, [refresh]);
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
  const binding = bindings.find((b) => sameTarget(b.target, target));
  const key = target.kind === "narrator" ? "narrator" : target.character_id;
  async function bind(voice: VoiceRef) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailed(false);
    const captured = target;
    try {
      const [project, current] = await Promise.all([
        commands.localProjectSnapshot(projectId),
        commands.voiceBindingBindings(projectId),
      ]);
      await commands.voiceBindingEdit(
        projectId,
        captured,
        crypto.randomUUID(),
        project.revision,
        current.find((b) => sameTarget(b.target, captured))?.revision ?? 0,
        { type: "bind", voice },
      );
      await refresh();
      await onSaved();
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
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
        disabled={busy}
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
          {bindings.some((b) => b.target.kind === "narrator" && b.voice)
            ? ""
            : ` · ${t`未绑定`}`}
        </option>
        {characters.map((c) => (
          <option key={c.id} value={c.id}>
            {c.displayName}
            {bindings.some(
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
      {resources.loading && (
        <p className="text-muted-foreground text-xs" role="status">
          <Trans>正在校验模型资源…</Trans>
        </p>
      )}
      {resources.error && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void resources.refresh()}
        >
          <Trans>重试读取模型</Trans>
        </Button>
      )}
      <CharacterVoicePicker
        key={key}
        libraryVoices={[]}
        models={resources.entries}
        busy={busy || studio.pending || resources.loading}
        studio={studio}
        current={binding?.voice ?? null}
        onPick={(voice) => void bind(voice)}
        production
      />
      {busy && (
        <p role="status" className="text-muted-foreground text-xs">
          <Trans>正在保存…</Trans>
        </p>
      )}
      {failed && (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void refresh()
              .then(() => setFailed(false))
              .catch(() => setFailed(true))
          }
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
