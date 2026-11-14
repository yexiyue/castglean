import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import { useStudioOperations } from "@/hooks/use-studio-operations";

export function ReferenceRecovery() {
  const operations = useStudioOperations();
  const { t } = useLingui();
  const op = operations.reference;
  if (!op) return null;
  return (
    <div
      role="status"
      className="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-xs"
    >
      <div className="min-w-0 flex-1 wrap-anywhere">
        <Trans>参考录音：{op.name}</Trans>
        <span className="block">
          {op.busy ? (
            <Trans>正在确认参考录音…</Trans>
          ) : op.missing ? (
            <Trans>候选已创建，但当前列表中找不到；它可能已被移除。</Trans>
          ) : op.phase === "read" ? (
            <Trans>候选已创建，读取列表失败。</Trans>
          ) : (
            <Trans>
              选择结果尚未确认；重试保留原请求，停止恢复前请检查候选列表。
            </Trans>
          )}
        </span>
        {!op.busy && op.failed && op.phase === "select" && (
          <span className="block">
            <Trans>
              原请求可能因录音无效或读取失败而结束；重试不会重新打开已完成的选择器。读取后停止恢复，可重新选择文件。
            </Trans>
          </span>
        )}
      </div>
      {!op.busy && (
        <>
          <Button
            size="xs"
            variant="outline"
            aria-label={
              op.phase === "read"
                ? t`重新读取「${op.name}」的录音候选`
                : t`重试「${op.name}」的录音选择`
            }
            onClick={() => void operations.resumeReference()}
          >
            {op.phase === "read" ? (
              <Trans>重试读取</Trans>
            ) : (
              <Trans>重试原请求</Trans>
            )}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            aria-label={t`读取后停止恢复「${op.name}」的录音选择`}
            onClick={() => void operations.abandonReference()}
          >
            <Trans>读取后停止恢复</Trans>
          </Button>
        </>
      )}
    </div>
  );
}
