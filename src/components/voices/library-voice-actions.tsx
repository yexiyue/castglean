import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import { commands, type LibraryVoice } from "@/lib/bindings";
import { AuditionPanel } from "./audition-panel";
import { StudioJobs } from "./studio-jobs";
import { useVoicePlayer } from "./voice-player";

export function LibraryVoiceActions({
  voice,
  onChanged,
  onDeleted,
}: {
  voice: LibraryVoice;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
}) {
  const formId = useId();
  const studio = useVoiceStudio();
  const player = useVoicePlayer();
  const [name, setName] = useState(voice.name);
  return (
    <div
      className="flex flex-col gap-5 p-6 pb-32"
      style={{ paddingBottom: "max(8rem, var(--voice-player-inset, 0px))" }}
    >
      <Button
        variant="outline"
        onClick={() =>
          void studio.run(async () => {
            const audio = await commands.voiceReferenceAudio(voice.id);
            await player.play(audio, voice.name, voice.transcript);
          })
        }
      >
        <Trans comment="无需模型播放库资产的原始参考">播放原始参考</Trans>
      </Button>
      <label htmlFor={`${formId}-1`} className="flex flex-col gap-2 text-sm">
        <Trans comment="修改已有音色的显示名">音色名称</Trans>
        <Input
          id={`${formId}-1`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={studio.pending || !name.trim() || name === voice.name}
          onClick={() =>
            void studio.run(async () => {
              await commands.renameLibraryVoice(voice.id, name);
              await onChanged();
            })
          }
        >
          <Trans comment="持久保存已有音色的新名称">保存名称</Trans>
        </Button>
        <Button
          variant="destructive"
          disabled={studio.pending}
          onClick={() =>
            void studio.run(async () => {
              if (await commands.deleteLibraryVoice(voice.id)) {
                await onChanged();
                onDeleted();
              }
            })
          }
        >
          <Trans comment="打开系统确认后删除当前库资产">删除音色</Trans>
        </Button>
      </div>
      <AuditionPanel
        studio={studio}
        voice={{ kind: "library", id: voice.id }}
      />
      <StudioJobs studio={studio} />
    </div>
  );
}
