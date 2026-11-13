import { Trans, useLingui } from "@lingui/react/macro";
import { type JSX, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useVoicePlayer } from "@/components/voices/voice-player";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import {
  commands,
  type LibraryVoice,
  type ModelEntry,
  type VoiceRef,
} from "@/lib/bindings";
import { playVoiceRef, sameVoice } from "@/lib/voice-audition";

interface CharacterVoicePickerProps {
  libraryVoices: LibraryVoice[];
  models: ModelEntry[];
  busy: boolean;
  studio: VoiceStudio;
  current: VoiceRef | null;
  production?: boolean;
  onPick: (voice: VoiceRef) => void;
}

export function CharacterVoicePickerDialog(
  props: CharacterVoicePickerProps & { label: string; onClose: () => void },
): JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent className="flex max-h-[80vh] flex-col">
        <DialogHeader>
          <DialogTitle>
            <Trans>为「{props.label}」选择音色</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>试听后直接选择声音，绑定会自动保存。</Trans>
          </DialogDescription>
        </DialogHeader>
        <CharacterVoicePicker {...props} />
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
  production = false,
  onPick,
}: CharacterVoicePickerProps): JSX.Element {
  const { t } = useLingui();
  const player = useVoicePlayer();
  const [query, setQuery] = useState("");
  const [model, setModel] = useState("all");
  const matches = (text: string) =>
    text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const presets = models.filter(
    (model) => model.voice_catalog.length > 0 && model.resource === "Ready",
  );
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <NativeSelect
        aria-label={t`筛选声音模型`}
        value={model}
        onChange={(e) => setModel(e.target.value)}
      >
        <option value="all">{t`全部就绪模型`}</option>
        {!production && <option value="library">{t`本地音色库`}</option>}
        {presets.map((entry) => (
          <option
            key={`${entry.backend}/${entry.model}`}
            value={`${entry.backend}/${entry.model}`}
          >
            {entry.name}
          </option>
        ))}
      </NativeSelect>
      <Input
        aria-label={t`搜索音色`}
        placeholder={t`搜索音色名称或 ID`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-80 min-h-0 overflow-y-auto">
        {!production && (model === "all" || model === "library") && (
          <>
            <h4 className="text-muted-foreground py-2 text-xs">
              <Trans>本地音色库（{libraryVoices.length}）</Trans>
            </h4>
            {libraryVoices
              .filter((voice) => matches(`${voice.name} ${voice.id}`))
              .map((voice) => (
                <VoiceChoiceRow
                  key={voice.id}
                  name={voice.name}
                  description={voice.description ?? t`无描述`}
                  selected={
                    current !== null &&
                    sameVoice(current, { kind: "library", id: voice.id })
                  }
                  busy={busy}
                  onPreview={() =>
                    void studio.run(async () => {
                      const audio = await commands.voiceReferenceAudio(
                        voice.id,
                      );
                      await player.play(audio, voice.name, voice.transcript);
                    })
                  }
                  onPick={() => onPick({ kind: "library", id: voice.id })}
                />
              ))}
            {!libraryVoices.length ? (
              <p className="text-muted-foreground py-2 text-xs">
                <Trans>音色库为空，可先在音色中心导入或设计。</Trans>
              </p>
            ) : null}
          </>
        )}
        <h4 className="text-muted-foreground py-2 text-xs">
          <Trans>预置音色</Trans>
        </h4>
        {presets
          .filter(
            (entry) =>
              model === "all" || model === `${entry.backend}/${entry.model}`,
          )
          .map((entry) => (
            <section key={`${entry.backend}/${entry.model}`}>
              <p className="text-muted-foreground border-b py-2 text-xs">
                {entry.name}
              </p>
              {entry.voice_catalog
                .filter((preset) => matches(`${preset.name} ${preset.id}`))
                .map((preset) => {
                  const voice: VoiceRef = {
                    kind: "preset",
                    backend: entry.backend,
                    model: entry.model,
                    voice: preset.id,
                  };
                  return (
                    <VoiceChoiceRow
                      key={preset.id}
                      name={preset.name}
                      selected={current !== null && sameVoice(current, voice)}
                      busy={busy}
                      previewDisabled={entry.available_devices.length === 0}
                      onPreview={() =>
                        playVoiceRef({ voice, studio, player, models })
                      }
                      onPick={() => onPick(voice)}
                    />
                  );
                })}
            </section>
          ))}
        {!presets.length ? (
          <p className="text-muted-foreground py-2 text-xs">
            <Trans>暂无已就绪模型的预置音色，可前往模型中心准备。</Trans>
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface VoiceChoiceRowProps {
  name: string;
  description?: string;
  selected: boolean;
  busy: boolean;
  previewDisabled?: boolean;
  onPreview: () => void;
  onPick: () => void;
}

function VoiceChoiceRow({
  name,
  description,
  selected,
  busy,
  previewDisabled,
  onPreview,
  onPick,
}: VoiceChoiceRowProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-sm">
        {name}
        {description !== undefined && (
          <span className="text-muted-foreground block truncate text-xs">
            {description}
          </span>
        )}
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy || previewDisabled}
        onClick={onPreview}
      >
        <Trans>试听</Trans>
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={onPick}>
        {selected ? <Trans>当前绑定</Trans> : <Trans>绑定</Trans>}
      </Button>
    </div>
  );
}
