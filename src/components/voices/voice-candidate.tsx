import { useCandidateMutation } from "@/hooks/use-candidate-mutation";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import type { CandidateView } from "@/lib/bindings";
import { auditionIdentity } from "@/lib/studio-operations";
import { AuditionPanel } from "./audition-panel";
import { StudioJobs } from "./studio-jobs";
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
  const voice = { kind: "candidate", id: candidate.id } as const;
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
      auditionResults={
        <StudioJobs
          studio={studio}
          scope={auditionIdentity(voice)}
          candidateId={candidate.id}
        />
      }
      onSave={mutation.save}
      onRemove={() => void mutation.remove()}
    >
      <AuditionPanel studio={studio} voice={voice} />
    </VoiceCandidateCard>
  );
}
