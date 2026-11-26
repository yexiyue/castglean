import { Trans, useLingui } from "@lingui/react/macro";
import { ListTreeIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { DelegatedToolContextValue } from "@/components/assistant-ui/tools/delegated-tool-context";
import { StructureRecovery } from "@/components/chapter-structure/recovery";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  commands,
  type ProposalInfo_Serialize,
  type ResultReference,
} from "@/lib/bindings";

/**
 * In-card split proposal: the difference summary plus whole-proposal
 * adopt/discard through the same host registry the review dialog uses; the
 * dialog stays the surface for boundary-level adjustment.
 */
export function SplitResultSurface({
  reference,
  context,
}: {
  reference: ResultReference;
  context: DelegatedToolContextValue;
}) {
  const { t } = useLingui();
  const operations = context.structureOperations;
  const operation = useSyncExternalStore(
    operations?.subscribe ?? (() => () => {}),
    operations?.snapshot ?? (() => null),
    operations?.snapshot ?? (() => null),
  );
  const recoverInCard =
    operation?.request.kind === "proposal" &&
    operation.request.proposalId === reference.id &&
    operation.request.surface === "assistant";
  const [proposal, setProposal] = useState<ProposalInfo_Serialize | null>(null);
  const [reading, setReading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [confirming, setConfirming] = useState(false);
  // Re-read the proposal after the shared structure operation completes.
  useEffect(() => {
    if (
      operation?.phase !== "done" ||
      operation.request.kind !== "proposal" ||
      operation.request.proposalId !== reference.id ||
      !operation.snapshot
    )
      return;
    setConfirming(false);
    setRevision((value) => value + 1);
  }, [operation, reference.id]);
  // Revision and version bumps must re-read mutable proposal status.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Revalidate status when the project changes or the user reloads.
  useEffect(() => {
    let live = true;
    setFailed(false);
    setReading(true);
    void commands
      .splitProposal(reference.id)
      .then((value) => {
        if (!live) return;
        if (value.projectId !== context.projectId)
          throw new Error("wrong_project");
        setProposal(value);
      })
      .catch(() => {
        if (live) setFailed(true);
      })
      .finally(() => {
        if (live) setReading(false);
      });
    return () => {
      live = false;
    };
  }, [context.projectId, reference.id, revision, context.version]);
  const stale =
    !!proposal &&
    (proposal.stale || proposal.baseRevision !== context.projectRevision);
  return (
    <Card size="sm" data-split-review-card={reference.id}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListTreeIcon aria-hidden className="size-4 shrink-0" />
          <Trans>候选分章方案</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {reading && !proposal ? (
          <p role="status" className="py-1 text-xs text-muted-foreground">
            <Trans>正在读取分章方案…</Trans>
          </p>
        ) : null}
        {failed ? (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-xs text-destructive">
              <Trans>分章方案读取未完成，已有内容可能过时。</Trans>
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRevision((value) => value + 1)}
            >
              <Trans>重新读取</Trans>
            </Button>
          </div>
        ) : null}
        {recoverInCard && operations && context.onStructureChange && (
          <StructureRecovery
            operations={operations}
            onRead={context.onStructureChange}
          />
        )}
        {proposal ? (
          <>
            <p className="text-xs wrap-anywhere text-muted-foreground">
              <Trans>
                {proposal.content.chapters.length} 章 · 新增{" "}
                {proposal.content.addedLines.length} · 移除{" "}
                {proposal.content.removedLines.length}
              </Trans>
            </p>
            <p role="status" className="text-xs text-muted-foreground">
              {proposal.status === "adopted"
                ? t`已采用`
                : proposal.status === "discarded"
                  ? t`已放弃`
                  : stale
                    ? t`方案已过期，采用前请重新生成。`
                    : t`待审阅`}
            </p>
            {proposal.status === "pending" && !stale && operations ? (
              confirming ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    <Trans>采用后应用为当前目录。</Trans>
                  </span>
                  <Button
                    size="sm"
                    disabled={!!operation || reading || failed}
                    onClick={() => decide("adopt")}
                  >
                    <Trans>确认采用</Trans>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirming(false)}
                  >
                    <Trans>取消</Trans>
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={!!operation || reading || failed}
                    onClick={() => setConfirming(true)}
                  >
                    <Trans>采用方案</Trans>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!operation || reading || failed}
                    onClick={() => decide("discard")}
                  >
                    <Trans>放弃</Trans>
                  </Button>
                </div>
              )
            ) : null}
          </>
        ) : null}
        {context.onReview ? (
          <div className="flex justify-start pt-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => context.onReview?.(reference)}
            >
              <Trans>打开审阅弹窗调整</Trans>
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );

  function decide(action: "adopt" | "discard") {
    if (!operations || operations.snapshot() || reading || failed) return;
    setConfirming(false);
    operations.start({
      kind: "proposal",
      surface: "assistant",
      projectId: context.projectId,
      proposalId: reference.id,
      action,
      commandId: crypto.randomUUID(),
      draftKey: null,
    });
  }
}
