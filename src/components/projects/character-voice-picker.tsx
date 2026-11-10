import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useVoicePlayer } from "@/components/voices/voice-player";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import {
  commands,
  type LibraryVoice,
  type ModelEntry,
  type VoiceRef,
} from "@/lib/bindings";
import { playVoiceRef } from "@/lib/voice-audition";

export function CharacterVoicePickerDialog({
  label,
  libraryVoices,
  models,
  busy,
  studio,
  current,
  onClose,
  onPick,
}: {
  label: string;
  libraryVoices: LibraryVoice[];
  models: ModelEntry[];
  busy: boolean;
  studio: VoiceStudio;
  current: VoiceRef | null;
  onClose: () => void;
  onPick: (voice: VoiceRef) => void;
}) {
  const { t } = useLingui();
  const player = useVoicePlayer();
  const presets = models.filter(
    (model) => model.voice_catalog.length > 0 && model.resource === "Ready",
  );
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="flex max-h-[80vh] flex-col">
        <DialogHeader>
          <DialogTitle>
            <Trans>为「{label}」选择音色</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              库音色与预置音色都可以绑定；预置音色需模型资源就绪后才能试听。
            </Trans>
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          <h4 className="text-muted-foreground py-2 text-xs">
            <Trans>本地音色库（{libraryVoices.length}）</Trans>
          </h4>
          {libraryVoices.map((voice) => (
            <div
              key={voice.id}
              className="flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {voice.name}
                <span className="text-muted-foreground block truncate text-xs">
                  {voice.description ?? t`无描述`}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void studio.run(async () => {
                    const audio = await commands.voiceReferenceAudio(voice.id);
                    await player.play(audio, voice.name, voice.transcript);
                  })
                }
              >
                <Trans>试听</Trans>
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onPick({ kind: "library", id: voice.id })}
              >
                {current?.kind === "library" && current.id === voice.id ? (
                  <Trans>当前绑定</Trans>
                ) : (
                  <Trans>绑定</Trans>
                )}
              </Button>
            </div>
          ))}
          {!libraryVoices.length ? (
            <p className="text-muted-foreground py-2 text-xs">
              <Trans>音色库为空，可先在音色中心导入或设计。</Trans>
            </p>
          ) : null}
          <h4 className="text-muted-foreground py-2 text-xs">
            <Trans>预置音色</Trans>
          </h4>
          {presets.flatMap((entry) =>
            entry.voice_catalog.map((preset) => {
              const voice: VoiceRef = {
                kind: "preset",
                backend: entry.backend,
                model: entry.model,
                voice: preset.id,
              };
              return (
                <div
                  key={`${entry.backend}:${entry.model}:${preset.id}`}
                  className="flex flex-wrap items-center gap-2 border-b py-2 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {preset.name}
                    <span className="text-muted-foreground block truncate text-xs">
                      {entry.name}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || entry.available_devices.length === 0}
                    onClick={() =>
                      playVoiceRef({ voice, studio, player, models })
                    }
                  >
                    <Trans>试听</Trans>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onPick(voice)}
                  >
                    {current?.kind === "preset" &&
                    current.voice === preset.id &&
                    current.backend === entry.backend &&
                    current.model === entry.model ? (
                      <Trans>当前绑定</Trans>
                    ) : (
                      <Trans>绑定</Trans>
                    )}
                  </Button>
                </div>
              );
            }),
          )}
          {!presets.length ? (
            <p className="text-muted-foreground py-2 text-xs">
              <Trans>暂无已就绪模型的预置音色，可前往模型中心准备。</Trans>
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
