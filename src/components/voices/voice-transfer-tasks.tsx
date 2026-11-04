import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import {
  activeVoiceTask,
  type VoiceTransfers,
} from "@/hooks/use-voice-transfers";
import {
  voiceFailureMessages,
  voiceStatusMessages,
  voiceTaskStageMessages,
} from "@/lib/voice-messages";

export function VoiceTransferTasks({
  transfers,
  onPreview,
}: {
  transfers: VoiceTransfers;
  onPreview: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {transfers.error && (
        <p role="alert" className="text-destructive text-sm">
          {t(
            voiceFailureMessages[transfers.error.code] ??
              voiceFailureMessages.Unavailable,
          )}
        </p>
      )}
      {transfers.tasks.map((task) => (
        <section key={task.id} className="border-border rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">
              {t(voiceTaskStageMessages[task.stage])} · {task.completed} /{" "}
              {task.total}
            </p>
            <div className="flex gap-2">
              {activeVoiceTask(task) ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={task.state === "Cancelling"}
                  onClick={() => void transfers.cancel(task.id)}
                >
                  <Trans comment="请求停止音色后台任务">取消任务</Trans>
                </Button>
              ) : task.preview ? (
                <Button variant="outline" size="sm" onClick={onPreview}>
                  <Trans comment="打开已检查音色包的选择列表">
                    查看导入预览
                  </Trans>
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void transfers.run(() => transfers.dismiss(task.id))
                  }
                >
                  <Trans comment="关闭音色任务结果，不删除已导入资产">
                    关闭结果
                  </Trans>
                </Button>
              )}
            </div>
          </div>
          {(task.bytes ?? 0) > 0 && (
            <p className="text-muted-foreground mt-2 text-xs">
              {((task.bytes ?? 0) / 1048576).toFixed(2)} MiB
            </p>
          )}
          {task.error && (
            <p role="alert" className="text-destructive mt-2 text-sm">
              {t(voiceFailureMessages[task.error.code])}
              {task.error.input_index !== null && (
                <Trans comment="失败包在本次选择中的一开始编号">
                  （文件 {task.error.input_index + 1}）
                </Trans>
              )}
            </p>
          )}
          {task.filename && task.state === "Completed" && (
            <p className="mt-2 text-sm">
              <Trans comment="音色包已实际发布到用户选择的保存位置">
                已保存：{task.filename}
              </Trans>
            </p>
          )}
          {task.items.length > 0 && (
            <ul className="mt-3 max-h-48 overflow-y-auto text-xs">
              {task.items.map((item) => (
                <li key={item.entry} className="py-1">
                  {item.name} · {t(voiceStatusMessages[item.status])}
                  {item.error && (
                    <> · {t(voiceFailureMessages[item.error.code])}</>
                  )}
                </li>
              ))}
            </ul>
          )}
          {task.state === "Cancelled" && (
            <p className="text-muted-foreground mt-2 text-xs">
              <Trans>任务已取消，已完成的音色会保留。</Trans>
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
