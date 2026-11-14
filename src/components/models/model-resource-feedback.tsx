import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ResourceState } from "@/lib/bindings";
import {
  downloadPercent,
  downloadProgress,
  type FailureKind,
  formatBytes,
  preparationPhaseLabels,
  transferActive,
  variantOf,
} from "@/lib/models";

const failureGuidance = {
  Network: {
    title: msg`无法连接下载源`,
    description: msg`检查网络连接，或更换下载源后重试。`,
    settings: true,
  },
  Auth: {
    title: msg`下载源拒绝访问`,
    description: msg`检查访问凭据是否有效，以及是否拥有该模型的下载权限。`,
    settings: true,
  },
  RateLimited: {
    title: msg`下载请求过于频繁`,
    description: msg`下载源暂时限制了请求，请稍后重试。`,
    settings: false,
  },
  NotFound: {
    title: msg`下载源中未找到模型文件`,
    description: msg`检查下载源是否包含此模型，或切换下载源后重试。`,
    settings: true,
  },
  Disk: {
    title: msg`无法写入模型目录`,
    description: msg`检查可用磁盘空间和目录写入权限，再重新准备资源。`,
    settings: true,
  },
  Cache: {
    title: msg`模型缓存不可用`,
    description: msg`检查缓存目录是否可访问，必要时选择其他目录后重试。`,
    settings: true,
  },
  Integrity: {
    title: msg`模型资源未通过校验`,
    description: msg`当前资源不能使用，请重新准备。若再次失败，可更换下载源后重试。`,
    settings: true,
  },
  PlanChanged: {
    title: msg`模型准备需求已变化`,
    description: msg`重新确认最新的下载体积和磁盘需求后，再开始准备。`,
    settings: false,
  },
  Busy: {
    title: msg`模型资源正被其他任务占用`,
    description: msg`等待相关任务结束后重试，无需重复发起下载。`,
    settings: false,
  },
  Internal: {
    title: msg`模型准备未能完成`,
    description: msg`请重试准备。若仍然失败，请重启应用后再次尝试。`,
    settings: false,
  },
} satisfies Record<
  FailureKind,
  {
    title: ReturnType<typeof msg>;
    description: ReturnType<typeof msg>;
    settings: boolean;
  }
>;

export function ModelFailureNotice({
  failure,
  onOpenSettings,
}: {
  failure: FailureKind;
  onOpenSettings?: () => void;
}) {
  const { t } = useLingui();
  const guidance = failureGuidance[failure];
  return (
    <div
      role="alert"
      data-slot="model-failure"
      className="border-destructive/25 rounded-surface flex items-start gap-3 border p-3"
    >
      <AlertTriangleIcon className="text-destructive mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-2">
        <p className="text-sm font-medium">{t(guidance.title)}</p>
        <p className="text-muted-foreground text-sm leading-6">
          {t(guidance.description)}
        </p>
        {guidance.settings && onOpenSettings && (
          <Button
            variant="link"
            size="inline"
            onClick={onOpenSettings}
          >
            <Trans comment="打开模型缓存目录与下载源设置以修复失败">
              检查存储与下载源
            </Trans>
          </Button>
        )}
      </div>
    </div>
  );
}

function RemainingTime({
  progress,
}: {
  progress: ReturnType<typeof downloadProgress>;
}) {
  if (!progress || progress.remainingSeconds === null || progress.stalled)
    return <Trans comment="尚无可靠的剩余下载时间">估算中</Trans>;
  if (progress.total > 0 && progress.downloaded >= progress.total)
    return <Trans>正在完成下载…</Trans>;
  if (progress.remainingSeconds < 60) return <Trans>不足 1 分钟</Trans>;
  const minutes = Math.ceil(progress.remainingSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const extraMinutes = minutes % 60;
  return hours > 0 ? (
    <Trans>
      约 {hours} 小时 {extraMinutes} 分钟
    </Trans>
  ) : (
    <Trans>约 {minutes} 分钟</Trans>
  );
}

export function ResourceProgressPanel({
  resource: state,
}: {
  resource: ResourceState;
}) {
  const { t, i18n } = useLingui();
  const resource = typeof state === "string" ? null : state;
  if (!resource) return null;
  const interrupted = resource.Interrupted;
  if (interrupted) {
    return (
      <div
        role="status"
        className="space-y-2 text-sm"
        data-slot="model-progress"
      >
        <p className="font-medium">
          <Trans>准备已中断</Trans>
        </p>
        <p className="text-muted-foreground leading-6">
          <Trans>继续准备前会重新确认资源需求。</Trans>
        </p>
        <p className="text-muted-foreground text-xs">
          {t(preparationPhaseLabels[interrupted.phase])}
        </p>
      </div>
    );
  }
  const stage = resource.Preparing;
  if (stage) {
    const percent =
      stage.completed !== null && stage.total !== null && stage.total > 0
        ? Math.min(100, Math.max(0, (stage.completed / stage.total) * 100))
        : null;
    return (
      <div className="space-y-3" data-slot="model-progress">
        <p role="status" className="text-sm font-medium">
          {t(preparationPhaseLabels[stage.phase])}
        </p>
        <Progress
          value={percent}
          aria-label={t(preparationPhaseLabels[stage.phase])}
        />
        <p
          className="text-muted-foreground truncate text-xs"
          title={stage.component}
        >
          {stage.component}
        </p>
      </div>
    );
  }
  const transfer = resource.Downloading ?? resource.Paused;
  if (!transfer) return null;
  const progress = downloadProgress(state);
  const percent = downloadPercent(state);
  const paused = variantOf(state) === "Paused";
  const completed =
    transfer.total_bytes !== null &&
    transfer.total_bytes > 0 &&
    transfer.downloaded_bytes !== null &&
    transfer.downloaded_bytes >= transfer.total_bytes;
  const stalled = !paused && !completed && !!progress?.stalled;
  const file = transfer.current_file?.split(/[\\/]/).pop();
  return (
    <div className="flex min-w-0 flex-col gap-3" data-slot="model-progress">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">
          {paused ? (
            <Trans>已暂停</Trans>
          ) : completed ? (
            <Trans>正在完成下载…</Trans>
          ) : (
            <Trans>下载中</Trans>
          )}
        </span>
        <span className="shrink-0 tabular-nums">
          {percent === null
            ? "—"
            : percent > 0 && percent < 0.1
              ? "<0.1%"
              : `${new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 1 }).format(percent)}%`}
        </span>
      </div>
      <Progress
        value={percent}
        aria-label={t({ comment: "模型实际下载字节进度", message: "下载进度" })}
        tone={paused || stalled ? "muted" : "default"}
      />
      <dl className="grid gap-2 text-xs tabular-nums">
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-muted-foreground">
            <Trans comment="实际接收的模型资源大小">已下载</Trans>
          </dt>
          <dd>
            {formatBytes(transfer.downloaded_bytes)} /{" "}
            {formatBytes(transfer.total_bytes)}
          </dd>
        </div>
        {!paused && !completed && (
          <>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted-foreground">
                <Trans comment="实际模型资源下载速度">下载速度</Trans>
              </dt>
              <dd>
                {stalled || progress?.bytesPerSecond == null
                  ? "—"
                  : `${formatBytes(progress.bytesPerSecond)}/s`}
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted-foreground">
                <Trans comment="根据宿主近期速率估算的剩余下载时间">
                  预计剩余
                </Trans>
              </dt>
              <dd>
                <RemainingTime progress={progress} />
              </dd>
            </div>
          </>
        )}
      </dl>
      {file && (
        <p className="text-muted-foreground truncate text-xs" title={file}>
          {file}
        </p>
      )}
      {paused && (
        <p role="status" className="text-muted-foreground text-xs leading-5">
          <Trans>进度已保留，点击“继续下载”可恢复。</Trans>
        </p>
      )}
      {stalled && (
        <p
          role="status"
          className="text-muted-foreground border-border border-t pt-3 text-xs leading-5"
        >
          <Trans>
            暂未收到新数据，任务仍在运行。可继续等待，或暂停后再继续下载。
          </Trans>
        </p>
      )}
    </div>
  );
}

/**
 * 列表用紧凑传输指示：不改变卡片/行高——速度与百分比是一行小字，
 * 进度是贴底边的 3px 细条；详细信息仍进详情弹窗。
 */
export function ListTransferText({
  state,
  className,
}: {
  state: ResourceState;
  className?: string;
}) {
  const { t } = useLingui();
  const variant = variantOf(state);
  if (!transferActive(state)) return null;
  const percent = downloadPercent(state);
  const rate = variant === "Downloading" ? downloadProgress(state) : null;
  const parts: string[] = [];
  if (rate?.bytesPerSecond) parts.push(`${formatBytes(rate.bytesPerSecond)}/s`);
  if (percent != null) parts.push(`${Math.floor(percent)}%`);
  if (!parts.length)
    parts.push(
      variant === "Paused"
        ? t({ message: "已暂停" })
        : t({ message: "下载中" }),
    );
  return (
    <span className={className}>
      {parts.join(" · ")}
      <span className="sr-only">
        {t({ comment: "列表传输指示前的状态词", message: "传输状态" })}
      </span>
    </span>
  );
}

export function ListProgressBar({ state }: { state: ResourceState }) {
  const variant = variantOf(state);
  if (!transferActive(state)) return null;
  const percent = downloadPercent(state);
  if (percent == null) return null;
  const paused = variant === "Paused";
  return (
    <span
      aria-hidden="true"
      className="bg-muted absolute inset-x-0 bottom-0 block h-0.75 overflow-hidden rounded-b-lg"
    >
      <span
        className={paused ? "bg-muted-foreground" : "bg-primary"}
        style={{
          display: "block",
          height: "100%",
          width: `${Math.min(100, Math.max(0, percent))}%`,
        }}
      />
    </span>
  );
}
