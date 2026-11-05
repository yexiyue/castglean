import { type ReactNode, useState } from "react";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import { commands, type LibraryVoice } from "@/lib/bindings";
import { AuditionPanel } from "./audition-panel";
import {
  LibraryVoiceEditor,
  type LibraryVoiceFeedback,
} from "./library-voice-editor";
import { StudioJobs } from "./studio-jobs";
import {
  LibraryVoiceProperties,
  VoiceDetailContent,
  VoiceReference,
} from "./voice-detail-content";
import { useVoicePlayer } from "./voice-player";

export function LibraryVoiceActions({
  voice,
  onChanged,
  onDeleted,
  exportAction,
}: {
  voice: LibraryVoice;
  onChanged: () => Promise<void>;
  onDeleted: (name: string) => void;
  exportAction: ReactNode;
}) {
  const studio = useVoiceStudio();
  const player = useVoicePlayer();
  const [name, setName] = useState(voice.name);
  const [savedName, setSavedName] = useState(voice.name);
  const [feedback, setFeedback] = useState<
    LibraryVoiceFeedback | "play-error" | null
  >(null);
  const save = () =>
    void studio.run(async () => {
      setFeedback("saving");
      const nextName = name.trim();
      try {
        await commands.renameLibraryVoice(voice.id, nextName);
      } catch {
        setFeedback("save-error");
        return;
      }
      setName(nextName);
      setSavedName(nextName);
      setFeedback("saved");
      await onChanged();
    });
  const remove = () =>
    void studio.run(async () => {
      setFeedback("deleting");
      try {
        await player.stop();
        if (!(await commands.deleteLibraryVoice(voice.id))) {
          setFeedback("cancelled");
          return;
        }
      } catch {
        setFeedback("delete-error");
        return;
      }
      onDeleted(savedName);
      await onChanged();
    });
  return (
    <VoiceDetailContent
      properties={<LibraryVoiceProperties voice={voice} />}
      reference={
        <VoiceReference
          voice={voice}
          busy={studio.pending || !studio.desktop}
          failed={feedback === "play-error"}
          onPlay={() =>
            void studio.run(async () => {
              setFeedback(null);
              let audio: string;
              try {
                audio = await commands.voiceReferenceAudio(voice.id);
              } catch {
                setFeedback("play-error");
                return;
              }
              await player.play(audio, savedName, voice.transcript);
            })
          }
        />
      }
      audition={
        <AuditionPanel
          studio={studio}
          voice={{ kind: "library", id: voice.id }}
        />
      }
      results={<StudioJobs studio={studio} />}
      management={
        <>
          {exportAction}
          <LibraryVoiceEditor
            name={name}
            savedName={savedName}
            busy={studio.pending || !studio.desktop}
            feedback={feedback === "play-error" ? null : feedback}
            onNameChange={(nextName) => {
              setName(nextName);
              setFeedback(null);
            }}
            onReset={() => {
              setName(savedName);
              setFeedback(null);
            }}
            onSave={save}
            onDelete={remove}
          />
        </>
      }
    />
  );
}
