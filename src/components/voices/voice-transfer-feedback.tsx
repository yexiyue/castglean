import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { AuxiliaryDialog } from "@/components/auxiliary-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  voiceFailureMessages,
  voiceStatusMessages,
  voiceTaskStageMessages,
} from "@/lib/voice-messages";
import type { VoiceError, VoiceTaskSnapshot } from "@/lib/voices";

const transferTitles = {
  Inspect: msg({ comment: "音色包导入前的检查任务", message: "检查音色包" }),
  Import: msg({ comment: "将已选择音色写入音色库的任务", message: "导入音色" }),
  Export: msg({ comment: "将音色打包保存到文件的任务", message: "导出音色包" }),
};

function transferStatus(task: VoiceTaskSnapshot) {
  switch (task.state) {
    case "Running":
      if (task.stage === "Completed") return msg`正在整理处理结果…`;
      return voiceTaskStageMessages[task.stage];
    case "Cancelling":
      return msg`正在取消，请稍候…`;
    case "Failed":
      return msg`处理未完成`;
    case "Cancelled":
      return msg({ comment: "音色传输任务已经停止", message: "已取消" });
    case "Completed":
      if (task.kind !== "Inspect") return msg`处理完成`;
      if (task.preview) return msg`检查完成，等待选择音色`;
      return msg`检查完成`;
  }
}

export function VoiceTransferFailure({ error }: { error: VoiceError }) {
  const { t } = useLingui();
  const fileNumber = error.input_index == null ? null : error.input_index + 1;
  return (
    <p role="alert" className="text-destructive text-sm leading-6">
      {t(voiceFailureMessages[error.code] ?? voiceFailureMessages.Unavailable)}
      {fileNumber !== null && (
        <Trans comment="问题文件在本次选择中的编号，从 1 开始">
          （文件 {fileNumber}）
        </Trans>
      )}
    </p>
  );
}

export function VoiceTransferFeedback({
  task,
  busy = false,
  onCancel,
  onDismiss,
  onPreview,
}: {
  task: VoiceTaskSnapshot;
  busy?: boolean;
  onCancel?: () => void;
  onDismiss?: () => void;
  onPreview?: () => void;
}) {
  const { t } = useLingui();
  const progressId = useId();
  const running = task.state === "Running";
  const active = running || task.state === "Cancelling";
  const counts = {
    Imported: 0,
    AlreadyPresent: 0,
    Skipped: 0,
    Failed: 0,
    Cancelled: 0,
    NotAttempted: 0,
  };
  for (const item of task.items) counts[item.status]++;
  const failure = task.error ?? task.items.find((item) => item.error)?.error;
  const fraction =
    Number.isFinite(task.total) &&
    task.total > 0 &&
    Number.isFinite(task.completed) &&
    task.completed >= 0 &&
    task.completed <= task.total
      ? (task.completed / task.total) * 100
      : null;
  return (
    <section className="rounded-surface min-w-0 space-y-3 border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{t(transferTitles[task.kind])}</h3>
        <p role="status" className="text-muted-foreground text-sm">
          {t(transferStatus(task))}
        </p>
      </div>
      {running && task.stage !== "Completed" && (
        <div className="space-y-2">
          <p
            id={progressId}
            className="text-muted-foreground text-sm tabular-nums"
          >
            {fraction === null ? (
              <Trans>当前步骤尚无可用进度。</Trans>
            ) : (
              <Trans comment="当前处理阶段的计数，不代表整个导入导出流程的完成度">
                当前步骤：{task.completed} / {task.total}
              </Trans>
            )}
          </p>
          <Progress value={fraction} aria-labelledby={progressId} />
        </div>
      )}
      {Number.isFinite(task.bytes) && (task.bytes ?? 0) > 0 && (
        <p className="text-muted-foreground text-xs tabular-nums">
          <Trans comment="后台已报告处理的字节数，不是传输速度">
            已处理数据：{((task.bytes ?? 0) / 1048576).toFixed(2)} MiB
          </Trans>
        </p>
      )}
      {failure && <VoiceTransferFailure error={failure} />}
      {!failure && task.state === "Failed" && (
        <p role="alert" className="text-destructive text-sm">
          <Trans>操作未完成，请检查文件和存储权限后重新操作。</Trans>
        </p>
      )}
      {task.kind === "Import" && !active && task.items.length > 0 && (
        <p className="text-sm leading-6">
          <Trans comment="导入结果按实际逐项报告汇总，已存在不计为新导入">
            新导入 {counts.Imported} · 已存在 {counts.AlreadyPresent} · 跳过{" "}
            {counts.Skipped} · 失败 {counts.Failed} · 取消 {counts.Cancelled} ·
            未执行 {counts.NotAttempted}
          </Trans>
        </p>
      )}
      {task.kind === "Export" &&
        task.filename &&
        task.state === "Completed" && (
          <p className="text-sm wrap-break-word">
            <Trans comment="音色包已实际发布到用户选择的保存位置">
              已保存：{task.filename}
            </Trans>
          </p>
        )}
      {task.kind === "Import" &&
        (task.state === "Failed" || task.state === "Cancelled") && (
          <p className="text-muted-foreground text-sm">
            <Trans>
              已导入的音色会保留。重新检查原音色包后，可跳过已存在的音色。
            </Trans>
          </p>
        )}
      {task.kind === "Export" &&
        (task.state === "Failed" || task.state === "Cancelled") && (
          <p className="text-muted-foreground text-sm">
            <Trans>请在我的音色中重新选择音色与保存位置，再次导出。</Trans>
          </p>
        )}
      {task.items.length > 0 && (
        <AuxiliaryDialog
          title={
            <>
              {" "}
              <Trans comment="展开逐项导入结果">查看每个音色的结果</Trans>{" "}
            </>
          }
        >
          <ul className="mt-2 max-h-48 divide-y overflow-y-auto">
            {task.items.map((item) => (
              <li key={item.entry} className="space-y-1 py-2">
                <p className="wrap-break-word">
                  {item.name} · {t(voiceStatusMessages[item.status])}
                </p>
                {item.error && <VoiceTransferFailure error={item.error} />}
              </li>
            ))}
          </ul>
        </AuxiliaryDialog>
      )}
      <div className="flex flex-wrap gap-2">
        {active ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || task.state === "Cancelling" || !onCancel}
            onClick={onCancel}
          >
            <Trans comment="请求停止音色后台任务">取消任务</Trans>
          </Button>
        ) : (
          <>
            {task.preview && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !onPreview}
                onClick={onPreview}
              >
                <Trans comment="打开已检查音色包的选择列表">查看导入预览</Trans>
              </Button>
            )}
            {(task.state === "Failed" || task.state === "Cancelled") &&
              (task.kind === "Export" ? (
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<Link to="/voices" search={{ library: "mine" }} />}
                >
                  <Trans comment="重新选择要导出的音色">前往我的音色</Trans>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !onPreview}
                  onClick={onPreview}
                >
                  <Trans comment="重新打开音色导入对话框，需选择并检查文件">
                    重新选择音色包
                  </Trans>
                </Button>
              ))}
            {onDismiss && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onDismiss}
              >
                <Trans comment="关闭音色任务结果，不删除已导入资产">
                  关闭结果
                </Trans>
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
