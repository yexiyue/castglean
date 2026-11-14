import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import { useStudioOperations } from "@/hooks/use-studio-operations";

export function StudioRecovery() {
  const operations = useStudioOperations();
  const { t } = useLingui();
  return Array.from(operations.entries.values())
    .filter((operation) => operation.request.kind !== "audition")
    .map((operation) => {
      if (operation.request.kind === "audition") return null;
      const target =
        operation.request.kind === "design"
          ? operation.request.name
          : operation.request.engine;
      return (
        <div
          key={operation.identity}
          role="status"
          className="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-xs"
        >
          <div className="min-w-0 flex-1 wrap-anywhere">
            {operation.request.kind === "design" ? (
              <Trans>音色设计：{target}</Trans>
            ) : (
              <Trans>准备设计引擎：{target}</Trans>
            )}
            <span className="block">
              {operation.busy ? (
                <Trans>正在确认任务…</Trans>
              ) : operation.startError === "retired" ? (
                <Trans>
                  原任务已移除，不会重复创建；可重新读取后停止恢复。
                </Trans>
              ) : operation.startError === "limit" ? (
                <Trans>
                  本次会话的任务身份数量已达上限；请停止恢复并重启应用后再创建任务。
                </Trans>
              ) : operation.missing ? (
                <Trans>任务已创建，但当前列表中找不到；它可能已被移除。</Trans>
              ) : operation.phase === "read" ? (
                <Trans>任务已创建，读取状态失败。</Trans>
              ) : (
                <Trans>
                  请求尚未确认；重试会沿用原请求，停止恢复不会撤销可能已开始的任务。
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
                    ? t`重新读取「${target}」任务`
                    : t`重试「${target}」的原请求`
                }
                onClick={() => void operations.resume(operation.identity)}
              >
                {operation.phase === "read" ? (
                  <Trans>重试读取</Trans>
                ) : (
                  <Trans>重试原请求</Trans>
                )}
              </Button>
            )}
          {!operation.busy &&
            (operation.phase === "start" || operation.missing) && (
              <Button
                size="xs"
                variant="ghost"
                aria-label={t`读取后停止恢复「${target}」`}
                onClick={() => void operations.abandon(operation.identity)}
              >
                <Trans>读取后停止恢复</Trans>
              </Button>
            )}
        </div>
      );
    });
}
