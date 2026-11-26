import { Trans } from "@lingui/react/macro";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { LocalProjectSnapshot_Serialize } from "@/lib/bindings";
import type { StructureOperationRegistry } from "@/lib/structure-operation";

export function StructureRecovery({
  operations,
  onRead,
}: {
  operations: StructureOperationRegistry;
  onRead: (snapshot: LocalProjectSnapshot_Serialize) => void;
}) {
  const operation = useSyncExternalStore(
    operations.subscribe,
    operations.snapshot,
    operations.snapshot,
  );
  const busy = operation?.phase === "sending" || operation?.phase === "reading";
  return (
    operation &&
    operation.phase !== "done" && (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-xs">
        <span>
          {operation.phase === "confirmed-unread" ? (
            <Trans>结构操作已确认，但目录读取失败。</Trans>
          ) : operation.phase === "review" ? (
            <Trans>
              当前目录版本为 {operation.snapshot?.revision}
              ；读取结果不能确认原操作是否完成。停止核对不会撤销可能已完成的修改，之后无法按原身份重试。
            </Trans>
          ) : busy ? (
            <Trans>正在核对结构操作…</Trans>
          ) : (
            <Trans>结构操作结果尚未确认，原请求已保留。</Trans>
          )}
        </span>
        {(operation.phase === "unknown" ||
          operation.phase === "review" ||
          operation.phase === "confirmed-unread") && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void operations.retry()}
          >
            {operation.phase === "confirmed-unread" ? (
              <Trans>重新读取目录</Trans>
            ) : (
              <Trans>重试原操作</Trans>
            )}
          </Button>
        )}
        {operation.phase === "unknown" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void operations.review()}
          >
            <Trans>读取当前目录</Trans>
          </Button>
        )}
        {operation.phase === "review" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (operation.snapshot) onRead(operation.snapshot);
              operations.stop();
            }}
          >
            <Trans>停止核对并保留草稿</Trans>
          </Button>
        )}
      </div>
    )
  );
}
