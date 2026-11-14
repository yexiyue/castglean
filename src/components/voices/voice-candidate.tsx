import { useCandidateMutation } from "@/hooks/use-candidate-mutation";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import type { CandidateView } from "@/lib/bindings";
import { AuditionPanel } from "./audition-panel";
import { VoiceCandidateCard } from "./voice-candidate-card";
import { useVoicePlayer } from "./voice-player";

export function VoiceCandidate({
  candidate,
  studio,
}: {
  candidate: CandidateView;
  studio: VoiceStudio;
}) {
  const player = useVoicePlayer();
  const mutation = useCandidateMutation(
    candidate.id,
    candidate.voice.name,
    player.stop,
  );
  return (
    <VoiceCandidateCard
      candidate={candidate}
      busy={
        studio.pending ||
        studio.loading ||
        studio.loadError ||
        !studio.desktop ||
        !!mutation.operation
      }
      mutationDisabled={mutation.auditionPending}
      action={mutation.operation?.busy ? mutation.operation.action : null}
      failure={mutation.stopFailed ? "remove" : null}
      onPlay={() =>
        void player.play(
          candidate.audio,
          candidate.voice.name,
          candidate.voice.transcript,
        )
      }
      onSave={mutation.save}
      onRemove={() => void mutation.remove()}
    >
      <AuditionPanel
        studio={studio}
        voice={{ kind: "candidate", id: candidate.id }}
      />
    </VoiceCandidateCard>
  );
}
