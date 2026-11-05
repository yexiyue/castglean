import { Trans } from "@lingui/react/macro";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import type { CandidateView } from "@/lib/bindings";
import { AuditionPanel } from "./audition-panel";
import { VoiceCandidateCard } from "./voice-candidate-card";

const candidate: CandidateView = {
  id: "example-candidate",
  audio: "example-only",
  saved_id: null,
  voice: {
    id: "example-voice",
    name: "旁白 · 温和沉稳",
    transcript: "夜潮退去，渡口的灯还亮着。",
    description: null,
    source: null,
    created_at: null,
    imported_at: null,
    bytes: null,
    duration: null,
  },
};

export function VoiceCandidatesPreview() {
  const studio = useVoiceStudio();
  return (
    <section id="voice-candidate-states" className="scroll-mt-6 space-y-5">
      <h2 className="text-base font-semibold">
        <Trans>音色候选操作示例</Trans>
      </h2>
      <p className="text-muted-foreground text-sm">
        <Trans>
          以下为示例候选，可查看移除确认；不会播放音频、保存或移除数据。
        </Trans>
      </p>
      <div className="grid max-w-4xl items-start gap-5 md:grid-cols-2">
        <VoiceCandidateCard candidate={candidate}>
          <AuditionPanel
            studio={{ ...studio, desktop: false }}
            voice={{ kind: "candidate", id: candidate.id }}
          />
        </VoiceCandidateCard>
        <VoiceCandidateCard
          candidate={{ ...candidate, saved_id: "example-saved" }}
        />
        <VoiceCandidateCard candidate={candidate} action="save" />
        <VoiceCandidateCard candidate={candidate} failure="save" />
        <VoiceCandidateCard candidate={candidate} failure="remove" />
      </div>
    </section>
  );
}
