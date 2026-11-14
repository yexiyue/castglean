import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { AlertTriangleIcon } from "lucide-react";
import {
  ModelFailureNotice,
  ResourceProgressPanel,
} from "@/components/models/model-resource-feedback";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { StudioJob } from "@/lib/bindings";
import { failureKind, variantOf } from "@/lib/models";

export function StudioJobFeedback({
  job,
  busy = false,
  onPlay,
  onCancel,
  onRetry,
  onDismiss,
  onOpenSettings,
}: {
  job: StudioJob;
  busy?: boolean;
  onPlay?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
  onOpenSettings?: () => void;
}) {
  const { t } = useLingui();
  const active = job.state === "Queued" || job.state === "Running";
  const terminal = ["Succeeded", "Cancelled", "Failed"].includes(job.state);
  const preparing = job.request.kind === "prepare_design";
  const resourceProgress =
    job.state === "Running" &&
    job.stage === "downloading" &&
    job.resource != null &&
    ["Downloading", "Preparing", "Paused"].includes(variantOf(job.resource));
  const resourceFailure = job.resource ? failureKind(job.resource) : null;
  let title = t({ comment: "合成一段用于试听的声音", message: "生成试听" });
  if (job.request.kind === "design") title = job.request.name;
  if (preparing)
    title = t({
      comment: "下载音色设计引擎所需资源的任务",
      message: "准备音色设计资源",
    });
  const engine =
    job.request.kind === "audition"
      ? job.request.model || job.request.backend
      : job.request.engine;
  let runningStatus = t({
    comment: "未提供更细阶段的音色任务",
    message: "处理中",
  });
  if (job.stage === "downloading")
    runningStatus = t({
      comment: "音色任务正在下载所需模型资源",
      message: "准备资源中",
    });
  if (job.stage === "generating")
    runningStatus = t({
      comment: "正在用声音模型合成音频",
      message: "生成音频中",
    });
  if (job.stage === "loading")
    runningStatus = t({
      comment: "音色任务正在加载模型",
      message: "准备模型中",
    });
  const statuses = {
    Queued: t({ comment: "等待引擎开始执行音色任务", message: "排队中" }),
    Running: runningStatus,
    Cancelling: t({ comment: "等待语音模型安全停止", message: "正在取消…" }),
    Cancelled: t({ comment: "音色任务已被用户取消", message: "已取消" }),
    Failed: t({ comment: "音色任务未成功结束", message: "未完成" }),
    Succeeded: t({ comment: "音色任务的结果已就绪", message: "已完成" }),
  };
  return (
    <section
      className="border-border bg-card rounded-surface flex min-w-0 flex-col gap-4 border p-4"
      data-slot="studio-job"
      data-state={job.state}
      aria-label={title}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium wrap-break-word">{title}</h3>
          <p className="text-muted-foreground mt-1 text-xs wrap-anywhere">
            {engine}
          </p>
        </div>
        <span role="status" className="text-muted-foreground text-xs">
          {statuses[job.state]}
        </span>
      </div>
      {job.request.kind !== "prepare_design" && (
        <p className="text-muted-foreground line-clamp-2 text-sm leading-6">
          {job.request.text}
        </p>
      )}
      {resourceProgress && job.resource ? (
        <ResourceProgressPanel resource={job.resource} />
      ) : active ? (
        <div className="space-y-2">
          {job.state === "Running" && (
            <Progress value={null} aria-label={statuses[job.state]} />
          )}
          <p className="text-muted-foreground text-xs leading-5">
            {job.state === "Queued" ? (
              <Trans>等待前面的任务结束后开始。</Trans>
            ) : preparing || job.stage === "loading" ? (
              <Trans>正在准备所需资源，请稍候。</Trans>
            ) : (
              <Trans>生成时长取决于文本和设备，当前不提供进度估算。</Trans>
            )}
          </p>
        </div>
      ) : null}
      {job.state === "Cancelling" && (
        <p className="text-muted-foreground text-sm leading-6">
          <Trans>正在等待模型停止并释放资源，请稍候。</Trans>
        </p>
      )}
      {job.state === "Cancelled" && (
        <p className="text-muted-foreground text-sm leading-6">
          <Trans>任务已停止，可以重新发起。</Trans>
        </p>
      )}
      {job.state === "Succeeded" && preparing && (
        <p className="text-muted-foreground text-sm leading-6">
          <Trans>资源已准备完成，可以返回音色创建继续生成。</Trans>
        </p>
      )}
      {job.state === "Failed" &&
        (resourceFailure ? (
          <ModelFailureNotice
            failure={resourceFailure}
            onOpenSettings={onOpenSettings}
          />
        ) : (
          <div
            role="alert"
            className="border-destructive/25 rounded-surface flex items-start gap-3 border p-3"
            data-slot="studio-failure"
          >
            <AlertTriangleIcon className="text-destructive mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-medium">
                <Trans>音色任务未能完成</Trans>
              </p>
              <p className="text-muted-foreground text-sm leading-6">
                {preparing ? (
                  <Trans>请检查下载源与存储位置后重试。</Trans>
                ) : (
                  <Trans>
                    本次任务没有生成可用结果。请检查模型资源和计算设备，再重试生成。
                  </Trans>
                )}
              </p>
              {preparing && onOpenSettings && (
                <Button variant="link" size="inline" onClick={onOpenSettings}>
                  <Trans>检查存储与下载源</Trans>
                </Button>
              )}
            </div>
          </div>
        ))}
      <div className="flex flex-wrap items-center gap-2">
        {active && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !onCancel}
            onClick={onCancel}
          >
            <Trans comment="停止当前后台音色任务">取消任务</Trans>
          </Button>
        )}
        {job.state === "Succeeded" && job.audio && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !onPlay}
            onClick={onPlay}
          >
            <Trans comment="播放音色任务生成的音频">播放结果</Trans>
          </Button>
        )}
        {(job.state === "Failed" || job.state === "Cancelled") && (
          <Button size="sm" disabled={busy || !onRetry} onClick={onRetry}>
            <Trans comment="使用原始参数重新发起一个音色任务">重新尝试</Trans>
          </Button>
        )}
        {job.state === "Failed" && !preparing && (
          <Link
            to="/models"
            search={
              job.request.kind === "audition"
                ? { model: `${job.request.backend}/${job.request.model}` }
                : {}
            }
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            <Trans comment="查看导致音色任务无法执行的模型资源">
              检查模型资源
            </Trans>
          </Link>
        )}
        {terminal && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !onDismiss}
            onClick={onDismiss}
          >
            <Trans comment="移除已结束的音色任务记录">关闭结果</Trans>
          </Button>
        )}
      </div>
    </section>
  );
}
