import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import { useStudioOperations } from "@/hooks/use-studio-operations";

export function CandidateMutationRecovery() {
  const operations = useStudioOperations();
  const { t } = useLingui();
  return Array.from(operations.candidates.values()).map((op) => {
    const label = `${op.name} · ${op.id}`;
    return (
      <div
        key={op.id}
        role="status"
        className="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-xs"
      >
        <div className="min-w-0 flex-1 wrap-anywhere">
          {op.action === "save" ? (
            <Trans>保存候选：{label}</Trans>
          ) : (
            <Trans>移除候选：{label}</Trans>
          )}
          <span className="block">
            {op.busy ? (
              <Trans>正在核对候选状态…</Trans>
            ) : op.phase === "read" && !op.checked ? (
              <Trans>操作已确认，读取候选状态失败。</Trans>
            ) : op.phase === "read" ? (
              op.action === "save" ? (
                <Trans>保存已确认，但候选状态不一致；请到音色库核对。</Trans>
              ) : (
                <Trans>移除已确认，但候选仍在列表中；请重新读取核对。</Trans>
              )
            ) : !op.checked ? (
              <Trans>操作结果尚未确认，请先读取候选状态。</Trans>
            ) : op.current === "missing" ? (
              <Trans>当前列表中没有此候选；原操作结果可能无法确认。</Trans>
            ) : op.current === "saved" ? (
              <Trans>当前候选已在音色库中，请核对后继续。</Trans>
            ) : (
              <Trans>当前候选尚未保存，请核对后继续。</Trans>
            )}
          </span>
        </div>
        {!op.busy && op.phase === "read" && (
          <Button
            size="xs"
            variant="outline"
            aria-label={t`重新读取候选「${label}」`}
            onClick={() => void operations.resumeCandidate(op.id)}
          >
            <Trans>重试读取</Trans>
          </Button>
        )}
        {!op.busy && op.phase === "write" && !op.checked && (
          <Button
            size="xs"
            variant="outline"
            aria-label={t`读取候选「${label}」状态`}
            onClick={() => void operations.checkCandidate(op.id)}
          >
            <Trans>读取候选状态</Trans>
          </Button>
        )}
        {!op.busy &&
          op.phase === "write" &&
          op.checked &&
          op.current !== "missing" && (
            <Button
              size="xs"
              variant="outline"
              aria-label={t`重试候选「${label}」的原操作`}
              onClick={() => void operations.resumeCandidate(op.id)}
            >
              <Trans>重试原操作</Trans>
            </Button>
          )}
        {!op.busy && op.checked && (
          <Button
            size="xs"
            variant="ghost"
            aria-label={t`停止恢复候选「${label}」`}
            onClick={() => operations.stopCandidateRecovery(op.id)}
          >
            <Trans>停止恢复</Trans>
          </Button>
        )}
      </div>
    );
  });
}
