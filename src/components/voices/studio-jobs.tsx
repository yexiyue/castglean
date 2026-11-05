import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import { commands } from "@/lib/bindings";
import { downloadPercent, formatBytes } from "@/lib/models";
import { useVoicePlayer } from "./voice-player";

export function StudioJobs({ studio }: { studio: VoiceStudio }) {
  const { t } = useLingui();
  const player = useVoicePlayer();
  const labels = {
    Queued: t({ comment: "语音任务等待执行", message: "排队中" }),
    Running: t({ comment: "语音任务正在执行", message: "执行中" }),
    Cancelling: t({ comment: "等待语音模型停止并释放", message: "取消中" }),
    Cancelled: t({ comment: "语音任务已停止", message: "已取消" }),
    Failed: t({ comment: "语音任务失败", message: "失败" }),
    Succeeded: t({ comment: "语音任务产物已就绪", message: "已完成" }),
  };
  return (
    <div className="flex flex-col gap-3">
      {studio.error && (
        <p role="alert" className="text-destructive text-sm">
          {studio.error}
        </p>
      )}
      {studio.jobs.map((job) => (
        <div
          key={job.id}
          className="border-border flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm"
        >
          <span>
            #{job.id} · {labels[job.state]}
          </span>
          {job.request.kind === "audition" && (
            <span className="text-muted-foreground">
              {job.request.backend}/{job.request.model} · {job.request.device}
            </span>
          )}
          {job.request.kind === "design" && (
            <span className="text-muted-foreground">
              {job.request.engine} · {job.request.device}
            </span>
          )}
          {job.request.kind !== "prepare_design" && (
            <span className="text-muted-foreground max-w-72 truncate">
              {job.request.text}
            </span>
          )}
          {job.state === "Succeeded" && job.audio && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void player.play(
                  job.audio ?? "",
                  job.request.kind === "design"
                    ? job.request.name
                    : t({ message: "模型试听" }),
                  job.request.kind !== "prepare_design"
                    ? job.request.text
                    : undefined,
                )
              }
            >
              <Trans comment="播放已生成试听音频">播放结果</Trans>
            </Button>
          )}
          {["Queued", "Running", "Cancelling"].includes(job.state) && (
            <Button
              size="sm"
              variant="outline"
              disabled={job.state === "Cancelling"}
              onClick={() =>
                void studio.run(() => commands.cancelVoiceJob(job.id))
              }
            >
              <Trans comment="取消后台语音任务">取消任务</Trans>
            </Button>
          )}
          {["Succeeded", "Failed", "Cancelled"].includes(job.state) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void studio.run(async () => {
                  await player.stop();
                  await commands.dismissVoiceJob(job.id);
                });
              }}
            >
              <Trans comment="关闭任务记录并释放不再使用的试听">关闭结果</Trans>
            </Button>
          )}
          {job.resource &&
            typeof job.resource === "object" &&
            job.resource.Downloading && (
              <div className="w-full space-y-1">
                <Progress value={downloadPercent(job.resource)} />
                <p className="text-muted-foreground text-xs">
                  {formatBytes(job.resource.Downloading.downloaded_bytes)} /{" "}
                  {formatBytes(job.resource.Downloading.total_bytes)}
                </p>
              </div>
            )}
          {job.error && (
            <details>
              <summary>
                <Trans comment="展开任务失败诊断">详细原因</Trans>
              </summary>
              <p className="text-destructive break-all">{job.error}</p>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
