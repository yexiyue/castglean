import { Trans, useLingui } from "@lingui/react/macro";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import { commands } from "@/lib/bindings";
import { useDesktopSession } from "@/lib/desktop-session";
import { StudioJobFeedback } from "./studio-job-feedback";
import { useVoicePlayer } from "./voice-player";

export function StudioJobs({ studio }: { studio: VoiceStudio }) {
  const { t } = useLingui();
  const player = useVoicePlayer();
  const { openSettings } = useDesktopSession();
  if (!studio.error && studio.jobs.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {studio.error && (
        <div
          role="alert"
          className="border-destructive/25 space-y-2 rounded-md border p-3"
        >
          <p className="text-sm font-medium">
            <Trans>音色操作未完成</Trans>
          </p>
          <p className="text-muted-foreground text-sm leading-6">
            <Trans>请检查输入与当前任务状态后重试。已完成的结果仍保留。</Trans>
          </p>
        </div>
      )}
      {studio.jobs.map((job) => (
        <StudioJobFeedback
          key={job.id}
          job={job}
          busy={studio.pending}
          onOpenSettings={() => openSettings("storage")}
          onRetry={() => void studio.start(job.request)}
          onPlay={() => {
            if (job.audio)
              void player.play(
                job.audio,
                job.request.kind === "design"
                  ? job.request.name
                  : t({ message: "模型试听" }),
                job.request.kind !== "prepare_design"
                  ? job.request.text
                  : undefined,
              );
          }}
          onCancel={() =>
            void studio.run(() => commands.cancelVoiceJob(job.id))
          }
          onDismiss={() => {
            void studio.run(async () => {
              await player.stop();
              await commands.dismissVoiceJob(job.id);
            });
          }}
        />
      ))}
    </div>
  );
}
