import { Trans } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";

export function StartRecovery({
  missing,
  busy,
  onCheck,
  onRetry,
  onStop,
}: {
  missing: boolean;
  busy: boolean;
  onCheck: () => void;
  onRetry: () => void;
  onStop: () => void;
}) {
  return (
    <div
      role="alert"
      className="border-warning flex flex-wrap items-center gap-2 border-l-2 p-2 text-sm"
    >
      <span className="flex-1">
        <Trans>上次请求的结果尚未确认。请先核对，避免重复启动。</Trans>
      </span>
      <Button size="sm" variant="outline" disabled={busy} onClick={onCheck}>
        <Trans>核对原请求</Trans>
      </Button>
      {missing && (
        <>
          <span className="w-full">
            <Trans>当前未找到该请求；停止核对不会撤销可能已启动的任务。</Trans>
          </span>
          <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
            <Trans>重试原请求</Trans>
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onStop}>
            <Trans>再次核对后停止恢复</Trans>
          </Button>
        </>
      )}
    </div>
  );
}

export function StartRecovered({
  onAcknowledge,
  outcome,
}: {
  onAcknowledge: () => void;
  outcome: "accepted" | "abandoned";
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 border-l-2 border-primary p-2 text-sm"
    >
      <span className="flex-1">
        {outcome === "accepted" ? (
          <Trans>
            原请求已恢复。输入和引用仍保留，请检查后再发送，避免重复提交。
          </Trans>
        ) : (
          <Trans>
            已停止核对。原任务仍可能启动；输入和引用保留，请检查后再发送。
          </Trans>
        )}
      </span>
      <Button size="sm" variant="outline" onClick={onAcknowledge}>
        <Trans>我已了解</Trans>
      </Button>
    </div>
  );
}
