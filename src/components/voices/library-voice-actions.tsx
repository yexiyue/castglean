import { Trans } from "@lingui/react/macro";
import { type ReactNode, useState } from "react";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import { commands, type LibraryVoice } from "@/lib/bindings";
import { AuditionPanel } from "./audition-panel";
import {
  LibraryVoiceDescriptionEditor,
  LibraryVoiceEditor,
  type LibraryVoiceFeedback,
} from "./library-voice-editor";
import { StudioJobs } from "./studio-jobs";
import { VoiceBindingUsage } from "./voice-binding-usage";
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
    LibraryVoiceFeedback | "play-error" | "referenced" | null
  >(null);
  const [referenced, setReferenced] = useState<
    { projectId: string; projectTitle: string }[]
  >([]);
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
      setReferenced([]);
      try {
        await player.stop();
        if (!(await commands.deleteLibraryVoice(voice.id))) {
          setFeedback("cancelled");
          return;
        }
      } catch (cause) {
        const block = cause as { kind?: string; references?: unknown };
        if (block?.kind === "referenced" && Array.isArray(block.references)) {
          setReferenced(
            (
              block.references as { projectId: string; projectTitle: string }[]
            ).map((reference) => ({
              projectId: reference.projectId,
              projectTitle: reference.projectTitle,
            })),
          );
          setFeedback("referenced");
        } else {
          setFeedback("delete-error");
        }
        return;
      }
      onDeleted(savedName);
      await onChanged();
    });
  return (
    <VoiceDetailContent
      properties={<LibraryVoiceProperties voice={voice} />}
      references={<VoiceBindingUsage voiceId={voice.id} />}
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
          {feedback === "referenced" ? (
            <div
              role="alert"
              className="border-destructive/25 rounded-surface space-y-2 border p-3"
            >
              <p className="text-sm font-medium">
                <Trans comment="删除被工程绑定引用阻止">
                  此音色正被工程使用，先解绑再删除。
                </Trans>
              </p>
              <ul className="text-muted-foreground list-inside list-disc text-xs">
                {referenced.map((reference) => (
                  <li key={reference.projectId}>
                    {reference.projectTitle || reference.projectId}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <LibraryVoiceEditor
            name={name}
            savedName={savedName}
            busy={studio.pending || !studio.desktop}
            feedback={
              feedback === "play-error" || feedback === "referenced"
                ? null
                : feedback
            }
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
          <LibraryVoiceDescriptionEditor
            voiceId={voice.id}
            saved={voice.description ?? null}
            busy={studio.pending || !studio.desktop}
          />
        </>
      }
    />
  );
}
