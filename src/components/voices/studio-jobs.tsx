import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import type { ModelEntry } from "@/lib/bindings";
import { commands } from "@/lib/bindings";
import { useDesktopSession } from "@/lib/desktop-session";
import { StudioJobFeedback } from "./studio-job-feedback";
import { useVoicePlayer } from "./voice-player";

export function StudioJobs({
  studio,
  scope,
  models,
  candidateId,
}: {
  studio: VoiceStudio;
  scope: string;
  models?: ModelEntry[];
  candidateId?: string;
}) {
  const { t } = useLingui();
  const player = useVoicePlayer();
  const { openSettings } = useDesktopSession();
  const [failedScope, setFailedScope] = useState<string | null>(null);
  async function runAction(action: () => Promise<unknown>): Promise<void> {
    setFailedScope(null);
    const completed = await studio.run(async () => {
      await action();
      return true;
    });
    if (!completed) setFailedScope(scope);
  }
  const jobs = studio.jobs.filter((job) =>
    candidateId
      ? job.request.kind === "audition" &&
        job.request.voice.kind === "candidate" &&
        job.request.voice.id === candidateId
      : studio.scopeForJob(job.id) === scope,
  );
  if (jobs.length === 0) return null;
  return (
    <div data-slot="voice-operation-results" className="flex flex-col gap-3">
      {failedScope === scope && (
        <p role="alert" className="text-xs text-destructive">
          <Trans>音色操作未完成</Trans>
        </p>
      )}
      {jobs.map((job) => {
        const request = job.request;
        const preset =
          request.kind === "audition" && request.voice.kind === "preset"
            ? request.voice.voice
            : undefined;
        const model =
          request.kind === "audition"
            ? models?.find(
                (entry) =>
                  entry.backend === request.backend &&
                  entry.model === request.model,
              )
            : undefined;
        const name = preset
          ? (model?.voice_catalog.find((voice) => voice.id === preset)?.name ??
            preset)
          : undefined;
        return (
          <StudioJobFeedback
            key={job.id}
            job={job}
            busy={studio.pending}
            compact={
              name && request.kind === "audition"
                ? {
                    name,
                    model: model?.name ?? request.model,
                    playing: !!job.audio && player.playingId === job.audio,
                  }
                : undefined
            }
            onOpenSettings={() => openSettings("storage")}
            onRetry={() =>
              void studio.start(job.request, studio.originForJob(job.id), scope)
            }
            onPlay={() => {
              if (job.audio)
                void (name ? player.toggle : player.play)(
                  job.audio,
                  name ??
                    (job.request.kind === "design"
                      ? job.request.name
                      : t({ message: "模型试听" })),
                  job.request.kind !== "prepare_design"
                    ? job.request.text
                    : undefined,
                );
            }}
            onCancel={() =>
              void runAction(() => commands.cancelVoiceJob(job.id))
            }
            onDismiss={() => {
              void runAction(async () => {
                if (job.audio && player.playingId === job.audio)
                  await player.stop();
                await commands.dismissVoiceJob(job.id);
              });
            }}
          />
        );
      })}
    </div>
  );
}
