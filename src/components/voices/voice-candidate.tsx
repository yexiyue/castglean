import { useState } from "react";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import { type CandidateView, commands } from "@/lib/bindings";
import { AuditionPanel } from "./audition-panel";
import {
  type CandidateAction,
  VoiceCandidateCard,
} from "./voice-candidate-card";
import { useVoicePlayer } from "./voice-player";

export function VoiceCandidate({
  candidate,
  studio,
}: {
  candidate: CandidateView;
  studio: VoiceStudio;
}) {
  const player = useVoicePlayer();
  const [action, setAction] = useState<CandidateAction | null>(null);
  const [failure, setFailure] = useState<CandidateAction | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const perform = (next: CandidateAction) => {
    void studio.run(async () => {
      setAction(next);
      setFailure(null);
      try {
        if (next === "save") {
          const saved = await commands.saveVoiceCandidate(candidate.id);
          setSavedId(saved.id);
        } else {
          await player.stop();
          await commands.discardVoiceCandidate(candidate.id);
          setRemoved(true);
        }
      } catch {
        setFailure(next);
      } finally {
        setAction(null);
      }
    });
  };
  if (removed) return null;
  return (
    <VoiceCandidateCard
      candidate={{ ...candidate, saved_id: candidate.saved_id || savedId }}
      busy={studio.pending || !studio.desktop}
      action={action}
      failure={failure}
      onPlay={() =>
        void player.play(
          candidate.audio,
          candidate.voice.name,
          candidate.voice.transcript,
        )
      }
      onSave={() => perform("save")}
      onRemove={() => perform("remove")}
    >
      <AuditionPanel
        studio={studio}
        voice={{ kind: "candidate", id: candidate.id }}
      />
    </VoiceCandidateCard>
  );
}
