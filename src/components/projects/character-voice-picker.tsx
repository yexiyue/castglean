import { Trans, useLingui } from "@lingui/react/macro";
import { type JSX, useId } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SearchInput } from "@/components/ui/search-input";
import { useVoicePlayer } from "@/components/voices/voice-player";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import {
  commands,
  type LibraryVoice,
  type ModelEntry,
  type VoiceRef,
} from "@/lib/bindings";
import { useWorkspaceState } from "@/lib/desktop-session";
import { playVoiceRef, sameVoice } from "@/lib/voice-audition";

interface CharacterVoicePickerProps {
  libraryVoices: LibraryVoice[];
  models: ModelEntry[];
  busy: boolean;
  studio: VoiceStudio;
  current: VoiceRef | null;
  targetLabel: string;
  workspaceId: string;
  targetKey: string;
  modelsLoading: boolean;
  modelsError: boolean;
  onModelsRetry: () => void;
  production?: boolean;
  onPick: (voice: VoiceRef) => void;
}

type VoiceChoice = {
  key: string;
  voice: VoiceRef;
  name: string;
  source: string;
  description?: string;
  playable: boolean;
  transcript?: string;
};

function choiceId(choice: VoiceChoice) {
  return choice.voice.kind === "library" ? choice.voice.id : choice.voice.voice;
}

export function CharacterVoicePickerDialog({
  label,
  ...props
}: Omit<CharacterVoicePickerProps, "targetLabel"> & {
  label: string;
  onClose: () => void;
}): JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent scrollable="standard">
        <DialogHeader>
          <DialogTitle>
            <Trans>为「{label}」选择音色</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>选择声音后可试听，再明确绑定到目标。</Trans>
          </DialogDescription>
        </DialogHeader>
        <CharacterVoicePicker {...props} targetLabel={label} />
      </DialogContent>
    </Dialog>
  );
}

export function CharacterVoicePicker({
  libraryVoices,
  models,
  busy,
  studio,
  current,
  targetLabel,
  workspaceId,
  targetKey,
  modelsLoading,
  modelsError,
  onModelsRetry,
  production = false,
  onPick,
}: CharacterVoicePickerProps): JSX.Element {
  const { t } = useLingui();
  const pickerId = useId();
  const player = useVoicePlayer();
  const draftKey = `voicePicker:${production ? "chapter" : "character"}:${targetKey}`;
  const [query, setQuery] = useWorkspaceState(
    workspaceId,
    `${draftKey}:query`,
    "",
  );
  const [model, setModel] = useWorkspaceState(
    workspaceId,
    `${draftKey}:model`,
    "all",
  );
  const [chosen, setChosen] = useWorkspaceState<VoiceRef | null>(
    workspaceId,
    `${draftKey}:choice`,
    current,
  );
  const presets = models.filter(
    (entry) => entry.voice_catalog.length > 0 && entry.resource === "Ready",
  );
  const library: VoiceChoice[] = production
    ? []
    : libraryVoices.map((voice) => ({
        key: JSON.stringify(["library", voice.id]),
        voice: { kind: "library", id: voice.id },
        name: voice.name,
        source: t`本地音色库`,
        description: voice.description ?? undefined,
        transcript: voice.transcript,
        playable: true,
      }));
  const groups = presets.map((entry) => ({
    id: `${entry.backend}/${entry.model}`,
    name: entry.name,
    choices: entry.voice_catalog.map(
      (preset): VoiceChoice => ({
        key: JSON.stringify(["preset", entry.backend, entry.model, preset.id]),
        voice: {
          kind: "preset",
          backend: entry.backend,
          model: entry.model,
          voice: preset.id,
        },
        name: preset.name,
        source: entry.name,
        playable: entry.available_devices.length > 0,
      }),
    ),
  }));
  const all = [...library, ...groups.flatMap((group) => group.choices)];
  const selected = chosen
    ? all.find((choice) => sameVoice(choice.voice, chosen))
    : undefined;
  const matches = (choice: VoiceChoice) =>
    `${choice.name} ${choice.source} ${choice.voice.kind === "library" ? choice.voice.id : choice.voice.voice}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase());
  const visibleGroups = [
    ...(model === "all" || model === "library"
      ? [
          {
            id: "library",
            name: t`本地音色库`,
            choices: library.filter(matches),
          },
        ]
      : []),
    ...groups
      .filter((group) => model === "all" || model === group.id)
      .map((group) => ({ ...group, choices: group.choices.filter(matches) })),
  ].filter((group) => group.choices.length > 0);
  const alreadyBound =
    !!selected && !!current && sameVoice(selected.voice, current);
  function preview(choice: VoiceChoice) {
    if (choice.voice.kind === "library") {
      const id = choice.voice.id;
      void studio.run(async () => {
        const audio = await commands.voiceReferenceAudio(id);
        await player.play(audio, choice.name, choice.transcript);
      });
    } else playVoiceRef({ voice: choice.voice, studio, player, models });
  }
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <NativeSelect
        aria-label={t`筛选声音模型`}
        value={model}
        onChange={(event) => setModel(event.target.value)}
      >
        <option value="all">{t`全部就绪模型`}</option>
        {!production && <option value="library">{t`本地音色库`}</option>}
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </NativeSelect>
      <SearchInput
        aria-label={t`搜索音色`}
        placeholder={t`搜索音色名称或 ID`}
        value={query}
        onValueChange={setQuery}
      />
      {model !== "library" && modelsLoading && (
        <p role="status" className="text-muted-foreground text-xs">
          <Trans>正在校验模型资源…</Trans>
        </p>
      )}
      {model !== "library" && modelsError && (
        <div role="alert" className="text-destructive text-xs">
          <Trans>模型目录读取失败。</Trans>{" "}
          <Button size="xs" variant="ghost" onClick={onModelsRetry}>
            <Trans>重试读取模型</Trans>
          </Button>
        </div>
      )}
      {visibleGroups.length ? (
        <RadioGroup
          aria-label={t`选择要试听或绑定的音色`}
          value={selected?.key ?? ""}
          onValueChange={(value) =>
            setChosen(all.find((choice) => choice.key === value)?.voice ?? null)
          }
          className="max-h-80 min-h-0 gap-0 overflow-y-auto"
        >
          {visibleGroups.map((group) => (
            <section key={group.id} aria-label={group.name}>
              <h4 className="text-muted-foreground border-b py-2 text-xs wrap-anywhere">
                {group.name}
              </h4>
              {group.choices.map((choice) => (
                <label
                  key={choice.key}
                  htmlFor={`${pickerId}-${choice.key}`}
                  className="flex items-start gap-3 border-b py-2 text-sm"
                >
                  <RadioGroupItem
                    id={`${pickerId}-${choice.key}`}
                    value={choice.key}
                    disabled={busy}
                    aria-label={t`选择音色「${choice.name}」，来源：${choice.source}，ID：${choiceId(choice)}`}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 wrap-anywhere">
                    {choice.name}
                    {choice.description && (
                      <span className="text-muted-foreground block text-xs">
                        {choice.description}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </section>
          ))}
        </RadioGroup>
      ) : model !== "library" && (modelsLoading || modelsError) ? null : (
        <div className="text-muted-foreground text-sm" role="status">
          {query.trim() || model !== "all" ? (
            <>
              <Trans>没有匹配的音色。</Trans>{" "}
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setQuery("");
                  setModel("all");
                }}
              >
                <Trans>清除筛选</Trans>
              </Button>
            </>
          ) : (
            <Trans>没有可选择的音色，请在音色中心或模型中心准备。</Trans>
          )}
        </div>
      )}
      {selected && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          <p className="min-w-0 flex-1 text-sm wrap-anywhere">
            <Trans>
              已选择：{selected.name} · {selected.source}
            </Trans>
            {alreadyBound && (
              <span className="text-muted-foreground block text-xs">
                <Trans>当前绑定</Trans>
              </span>
            )}
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !selected.playable}
            aria-label={t`试听音色「${selected.name}」，来源：${selected.source}，ID：${choiceId(selected)}`}
            onClick={() => preview(selected)}
          >
            <Trans>试听</Trans>
          </Button>
          <Button
            size="sm"
            disabled={busy || alreadyBound}
            aria-label={t`将「${selected.name}」绑定给「${targetLabel}」，来源：${selected.source}，ID：${choiceId(selected)}`}
            onClick={() => onPick(selected.voice)}
          >
            <Trans>绑定</Trans>
          </Button>
          {!selected.playable && (
            <p className="text-muted-foreground w-full text-xs">
              <Trans>此模型没有可用的试听设备。</Trans>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
