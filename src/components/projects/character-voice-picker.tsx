import { Trans, useLingui } from "@lingui/react/macro";
import { LibraryIcon } from "lucide-react";
import { Fragment, type JSX, type ReactNode } from "react";
import { AppState } from "@/components/app-state";
import { ModelLogo } from "@/components/models/model-logo";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { StudioJobs } from "@/components/voices/studio-jobs";
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
  secondaryAction?: ReactNode;
  selectImmediately?: boolean;
  onAudition?: (voice: VoiceRef) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
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
  secondaryAction,
  selectImmediately = false,
  onAudition,
  open,
  defaultOpen,
  onOpenChange,
  onPick,
}: CharacterVoicePickerProps): JSX.Element {
  const { t } = useLingui();
  const player = useVoicePlayer();
  const draftKey = `voicePicker:${production ? "chapter" : "character"}:${targetKey}`;
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
  type VoiceGroup = {
    id: string;
    name: string;
    backend?: string;
    items: VoiceChoice[];
  };
  const groups: VoiceGroup[] = presets.map((entry) => ({
    id: `${entry.backend}/${entry.model}`,
    name: entry.name,
    backend: entry.backend,
    items: entry.voice_catalog.map(
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
  if (library.length > 0) {
    groups.unshift({ id: "library", name: t`本地音色库`, items: library });
  }
  const all = groups.flatMap((group) => group.items);
  const selection = selectImmediately ? current : chosen;
  const selected = selection
    ? all.find((choice) => sameVoice(choice.voice, selection))
    : undefined;
  const alreadyBound =
    !!selected && !!current && sameVoice(selected.voice, current);
  function auditionScope(choice: VoiceChoice): string {
    return JSON.stringify([
      "character-catalog",
      workspaceId,
      targetKey,
      choice.key,
    ]);
  }
  function preview(choice: VoiceChoice) {
    if (choice.voice.kind === "library") {
      const id = choice.voice.id;
      void studio.run(async () => {
        const audio = await commands.voiceReferenceAudio(id);
        await player.play(audio, choice.name, choice.transcript);
      });
    } else if (onAudition) {
      onAudition(choice.voice);
    } else {
      playVoiceRef({
        voice: choice.voice,
        studio,
        player,
        models,
        scope: auditionScope(choice),
      });
    }
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-3">
      <Combobox
        items={groups}
        value={selected ?? null}
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        onValueChange={(choice) => {
          if (!selectImmediately) setChosen(choice?.voice ?? null);
          else if (choice?.playable) onPick(choice.voice);
        }}
        itemToStringLabel={(choice) => choice.name}
        isItemEqualToValue={(item, value) => item.key === value.key}
        filter={(choice: VoiceChoice, query) =>
          `${choice.name} ${choice.source} ${choiceId(choice)}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase())
        }
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ComboboxTrigger
            render={
              <Button
                variant="outline"
                className="max-w-[min(100%,24rem)] min-w-0"
              />
            }
            aria-label={t`选择音色`}
            title={selected?.name}
            disabled={
              busy || (groups.length === 0 && (modelsLoading || modelsError))
            }
          >
            <span className="min-w-0 truncate">
              {selected?.name ?? t`选择音色`}
            </span>
          </ComboboxTrigger>
          {secondaryAction}
        </div>
        <ComboboxContent
          aria-label={t`选择音色`}
          className="flex flex-col data-[slot=combobox-content]:w-[max(22rem,var(--anchor-width))] data-[slot=combobox-content]:min-w-0 *:data-[slot=input-group]:m-2 *:data-[slot=input-group]:mb-0 *:data-[slot=input-group]:shrink-0"
        >
          <ComboboxInput
            showTrigger={false}
            aria-label={t`搜索音色`}
            placeholder={t`搜索音色名称或 ID`}
          />
          <ComboboxEmpty className="px-2">
            <AppState
              kind={groups.length > 0 ? "search" : "empty"}
              compact
              className="min-h-32"
              title={
                groups.length > 0
                  ? t`没有匹配的音色。`
                  : t`没有可选择的音色，请在音色中心或模型中心准备。`
              }
            />
          </ComboboxEmpty>
          <ComboboxList className="min-h-0 scroll-py-2 p-2">
            {(group: VoiceGroup, index: number) => (
              <Fragment key={group.id}>
                {index > 0 && <ComboboxSeparator className="mx-0 my-2" />}
                <ComboboxGroup items={group.items}>
                  <ComboboxLabel className="mb-1 flex items-center gap-2 py-1 font-medium">
                    {group.backend ? (
                      <ModelLogo backend={group.backend} size="sm" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex size-6 shrink-0 items-center justify-center"
                      >
                        <LibraryIcon className="size-4" />
                      </span>
                    )}
                    <span className="min-w-0 wrap-anywhere">{group.name}</span>
                  </ComboboxLabel>
                  <ComboboxCollection>
                    {(choice: VoiceChoice) => (
                      <ComboboxItem
                        key={choice.key}
                        value={choice}
                        aria-label={t`选择音色「${choice.name}」，来源：${choice.source}，ID：${choiceId(choice)}`}
                        className="min-h-8 pl-5"
                      >
                        <span className="min-w-0 wrap-anywhere">
                          {choice.name}
                          {choice.description && (
                            <span className="block text-xs text-muted-foreground">
                              {choice.description}
                            </span>
                          )}
                        </span>
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxGroup>
              </Fragment>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {modelsLoading && (
        <p role="status" className="text-xs text-muted-foreground">
          <Trans>正在校验模型资源…</Trans>
        </p>
      )}
      {modelsError && (
        <div role="alert" className="text-xs text-destructive">
          <Trans>模型目录读取失败。</Trans>{" "}
          <Button size="xs" variant="ghost" onClick={onModelsRetry}>
            <Trans>重试读取模型</Trans>
          </Button>
        </div>
      )}
      {selected && (production || !alreadyBound) && (
        <div className="flex min-w-0 flex-col gap-2 border-t pt-2">
          <p className="text-xs wrap-anywhere text-muted-foreground">
            {selected.source}
            {all.some(
              (choice) =>
                choice.key !== selected.key &&
                choice.name === selected.name &&
                choice.source === selected.source,
            )
              ? ` · ${choiceId(selected)}`
              : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !selected.playable}
              aria-label={t`试听音色「${selected.name}」，来源：${selected.source}，ID：${choiceId(selected)}`}
              onClick={() => preview(selected)}
            >
              {production ? (
                <Trans comment="合成一段用于试听的声音">生成试听</Trans>
              ) : (
                <Trans>试听</Trans>
              )}
            </Button>
            {!selectImmediately && (
              <Button
                size="sm"
                disabled={busy || alreadyBound}
                aria-label={t`将「${selected.name}」绑定给「${targetLabel}」，来源：${selected.source}，ID：${choiceId(selected)}`}
                onClick={() => onPick(selected.voice)}
              >
                <Trans>绑定</Trans>
              </Button>
            )}
          </div>
          {!selected.playable && (
            <p className="w-full text-xs text-muted-foreground">
              <Trans>此模型没有可用的试听设备。</Trans>
            </p>
          )}
        </div>
      )}
      {!onAudition && selected?.voice.kind === "preset" && (
        <StudioJobs
          studio={studio}
          scope={auditionScope(selected)}
          models={models}
        />
      )}
    </div>
  );
}
