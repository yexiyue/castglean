import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import { useStudioOperations } from "@/hooks/use-studio-operations";

export function AuditionRecovery() {
  const operations = useStudioOperations();
  const { t } = useLingui();
  return (
    <>
      {Array.from(operations.entries.values())
        .filter((operation) => operation.request.kind === "audition")
        .map((operation) => {
          if (operation.request.kind !== "audition") return null;
          const voice =
            operation.request.voice.kind === "preset"
              ? operation.request.voice.voice
              : operation.request.voice.id;
          const model = `${operation.request.backend} / ${operation.request.model}`;
          const source =
            operation.request.voice.kind === "preset"
              ? t`预置音色`
              : operation.request.voice.kind === "library"
                ? t`本地音色库`
                : t`候选音色`;
          const target = `${source} · ${voice} · ${model}`;
          return (
            <div
              key={operation.identity}
              role="status"
              className="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-xs"
            >
              <div className="min-w-0 flex-1 wrap-anywhere">
                <Trans>试听目标：{target}</Trans>
                <span className="block">
                  {operation.busy ? (
                    <Trans>正在确认试听任务…</Trans>
                  ) : operation.startError === "retired" ? (
                    <Trans>
                      原试听任务已经移除，不会重复创建；可重新读取后停止恢复。
                    </Trans>
                  ) : operation.startError === "limit" ? (
                    <Trans>
                      本次会话的任务身份数量已达上限；请停止恢复并重启应用后再创建任务。
                    </Trans>
                  ) : operation.missing ? (
                    <Trans>
                      试听任务已创建，但当前任务列表中找不到该任务；它可能已被移除。
                    </Trans>
                  ) : operation.phase === "read" ? (
                    <Trans>试听任务已创建，读取任务状态失败。</Trans>
                  ) : (
                    <Trans>
                      试听请求尚未确认；重试会沿用原请求，停止恢复不会撤销可能已开始的任务。
                    </Trans>
                  )}
                </span>
                {operation.abandonFailed && (
                  <span className="text-destructive block">
                    <Trans>重新读取失败，原请求仍保留。</Trans>
                  </span>
                )}
              </div>
              {!operation.busy &&
                operation.startError !== "retired" &&
                operation.startError !== "limit" && (
                  <Button
                    size="xs"
                    variant="outline"
                    aria-label={
                      operation.phase === "read"
                        ? t`重新读取「${target}」试听任务`
                        : t`重试「${target}」的原试听请求`
                    }
                    onClick={() => void operations.resume(operation.identity)}
                  >
                    {operation.phase === "read" ? (
                      <Trans>重试读取</Trans>
                    ) : (
                      <Trans>重试原试听请求</Trans>
                    )}
                  </Button>
                )}
              {!operation.busy &&
                (operation.phase === "start" || operation.missing) && (
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label={
                      operation.missing
                        ? t`停止跟踪「${target}」的试听任务`
                        : t`重新读取并停止恢复「${target}」的试听请求`
                    }
                    onClick={() => void operations.abandon(operation.identity)}
                  >
                    {operation.missing ? (
                      <Trans>停止跟踪</Trans>
                    ) : (
                      <Trans>重新读取并停止恢复</Trans>
                    )}
                  </Button>
                )}
            </div>
          );
        })}
    </>
  );
}
