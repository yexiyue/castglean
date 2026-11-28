import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ErrorState } from "@/components/assistant-ui/elements/error-state";
import type { DelegatedToolContextValue } from "@/components/assistant-ui/tools/delegated-tool-context";
import { SubagentCompletion } from "@/components/assistant-ui/tools/subagent-messages";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type Candidate_Serialize,
  commands,
  type ResultReference,
} from "@/lib/bindings";

type ResultState =
  | { kind: "reading" | "failed" }
  | {
      kind: "published";
      counts: { segments: number; pending: number } | null;
      countsReadFailed: boolean;
    }
  | { kind: "candidate"; candidate: Candidate_Serialize };

const subscribeInert = () => () => {};
const emptyVersion = () => 0;

export function AnalysisResultSurface({
  reference,
  context,
  showCompletionMessage = false,
}: {
  reference: ResultReference;
  context: DelegatedToolContextValue;
  showCompletionMessage?: boolean;
}) {
  const { t } = useLingui();
  const {
    projectId,
    candidateOperations: operations,
    onAnalysisSaved,
  } = context;
  const [result, setResult] = useState<ResultState>({ kind: "reading" });
  const [revision, setRevision] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [prepareFailed, setPrepareFailed] = useState(false);
  const key = JSON.stringify([projectId, reference.id]);
  useSyncExternalStore(
    operations?.subscribe ?? subscribeInert,
    operations?.snapshot ?? emptyVersion,
    operations?.snapshot ?? emptyVersion,
  );
  const operation = operations?.entries.get(key);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Revalidate mutable results on workspace changes and explicit reload.
  useEffect(() => {
    let live = true;
    setResult({ kind: "reading" });
    async function read(): Promise<ResultState> {
      try {
        const candidate = await commands.chapterAnalysisCandidate(
          projectId,
          reference.id,
        );
        return { kind: "candidate", candidate };
      } catch (error) {
        if (error !== "not_found") throw error;
        const target = await commands.chapterAnalysisResultTarget(
          projectId,
          reference.id,
        );
        const snapshot = await commands
          .chapterAnalysisSnapshot(projectId, target.chapterId)
          .catch(() => null);
        return {
          kind: "published",
          countsReadFailed: snapshot === null,
          counts:
            snapshot?.versionId === reference.id && !snapshot.stale
              ? {
                  segments: snapshot.segmentCount,
                  pending: snapshot.pendingCount,
                }
              : null,
        };
      }
    }
    void read()
      .then((value) => {
        if (live) setResult(value);
      })
      .catch(() => {
        if (live) setResult({ kind: "failed" });
      });
    return () => {
      live = false;
    };
  }, [projectId, reference.id, revision, context.version]);

  const candidate = result.kind === "candidate" ? result.candidate : null;
  const selected =
    candidate?.differences
      .filter((item) => !item.conflict)
      .map((item) => item.id) ?? [];
  const busy = preparing || !!operation?.inFlight;

  async function refreshSaved() {
    if (onAnalysisSaved) await onAnalysisSaved();
    const next = await commands.chapterAnalysisCandidate(
      projectId,
      reference.id,
    );
    setResult({ kind: "candidate", candidate: next });
  }

  async function submit(discard: boolean) {
    if (!operations || !candidate || operations.entries.has(key) || busy)
      return;
    setPreparing(true);
    setPrepareFailed(false);
    try {
      const expectedRevision =
        discard && candidate.stale
          ? (
              await commands.chapterAnalysisSnapshot(
                projectId,
                candidate.chapterId,
              )
            ).revision
          : candidate.baseRevision;
      if (operations.entries.has(key)) return;
      const request = {
        projectId,
        chapterId: candidate.chapterId,
        candidateId: candidate.id,
        commandId: crypto.randomUUID(),
        revision: expectedRevision,
        selected: discard ? null : selected,
        conflicts: [],
        phase: "write" as const,
        inFlight: false,
        rejected: false,
        failed: false,
      };
      operations.entries.set(key, request);
      await operations.process(key, request, refreshSaved);
    } catch {
      setPrepareFailed(true);
    } finally {
      setPreparing(false);
    }
  }

  function candidateStatus(value: Candidate_Serialize): string {
    if (value.status === "applied") return t`已采用`;
    if (value.status === "discarded") return t`已放弃`;
    if (value.sourceChanged)
      return t`章节来源已变化，请重新分析或打开检查器核对。`;
    if (value.stale) return t`归属候选已过期，请重新分析。`;
    return t`候选待采用 · 覆盖 ${value.differences.length} 处归属`;
  }

  return (
    <div data-analysis-review-card={reference.id} className="space-y-3">
      {result.kind === "reading" && (
        <p role="status" className="py-1 text-xs text-muted-foreground">
          <Trans>正在读取分析结果状态…</Trans>
        </p>
      )}
      {showCompletionMessage && (result.kind === "published" || candidate) && (
        <SubagentCompletion author={t`章节分析`}>
          {candidate ? (
            <Trans comment="Assistant reply after creating a separate chapter attribution candidate.">
              我已生成本章的归属候选，可以打开原文核对差异。
            </Trans>
          ) : (
            <Trans comment="Assistant reply after saving chapter attribution to the workbench.">
              我已保存本章的归属，可以打开原文核对说话人。
            </Trans>
          )}
        </SubagentCompletion>
      )}
      {(result.kind !== "reading" || context.onReview) && (
        <Card size="sm" className="gap-2 bg-muted/50 ring-0">
          <CardHeader>
            <CardTitle className="font-semibold">
              <Trans>角色归属</Trans>
            </CardTitle>
            {result.kind === "published" && (
              <CardAction className="text-xs leading-5 text-muted-foreground">
                <Trans>已保存</Trans>
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {result.kind === "published" && result.counts && (
              <p className="text-xs text-muted-foreground">
                <Plural
                  value={result.counts.segments}
                  one="已标注 # 个片段"
                  other="已标注 # 个片段"
                />
                {result.counts.pending > 0 && (
                  <>
                    {" · "}
                    <Plural
                      value={result.counts.pending}
                      one="# 处归属待核对"
                      other="# 处归属待核对"
                    />
                  </>
                )}
              </p>
            )}
            {result.kind === "published" &&
              reference.notice === "manual_attribution_updated" && (
                <p role="status" className="py-1 text-xs text-muted-foreground">
                  <Trans>
                    章节分析已保存，本次更新了已有人工归属，可撤回。
                  </Trans>
                </p>
              )}
            {(result.kind === "failed" ||
              (result.kind === "published" && result.countsReadFailed) ||
              prepareFailed) && (
              <ErrorState
                title={t`分析结果读取未完成，已有内容可能过时。`}
                retryLabel={t`重新读取`}
                onRetry={() => {
                  setPrepareFailed(false);
                  setRevision((value) => value + 1);
                }}
              />
            )}
            {candidate && (
              <p role="status" className="text-xs font-medium">
                {candidateStatus(candidate)}
              </p>
            )}
            {operation?.failed && operations && (
              <div className="flex flex-wrap items-center gap-2">
                <p role="alert" className="text-xs text-destructive">
                  {operation.phase === "read" ? (
                    <Trans>操作已保存，结果读取失败。</Trans>
                  ) : operation.rejected ? (
                    <Trans>操作未保存，请刷新后重试。已有结果保留。</Trans>
                  ) : (
                    <Trans>操作结果尚未确认，所选范围已保留。</Trans>
                  )}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (operation.rejected && operation.phase === "write") {
                      operations.entries.delete(key);
                      operations.notify();
                      setRevision((value) => value + 1);
                      return;
                    }
                    void operations.process(key, operation, refreshSaved);
                  }}
                >
                  {operation.rejected || operation.phase === "read"
                    ? t`重新读取结果`
                    : t`重试原操作`}
                </Button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {context.onReview && (
                <Button
                  size="sm"
                  onClick={(event) =>
                    context.onReview?.(reference, event.currentTarget)
                  }
                >
                  <Trans comment="Open the saved speaker assignments or attribution candidate in the chapter reader.">
                    查看归属
                  </Trans>
                </Button>
              )}
              {candidate?.status === "pending" && !operation && operations && (
                <>
                  <Button
                    size="sm"
                    variant={context.onReview ? "secondary" : "default"}
                    disabled={
                      busy ||
                      prepareFailed ||
                      candidate.stale ||
                      candidate.sourceChanged ||
                      !selected.length
                    }
                    onClick={() => void submit(false)}
                  >
                    <Trans>采用候选</Trans>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || prepareFailed}
                    onClick={() => void submit(true)}
                  >
                    <Trans>放弃候选</Trans>
                  </Button>
                  {context.onReanalyze && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => context.onReanalyze?.(candidate.chapterId)}
                    >
                      <Trans>重新分析</Trans>
                    </Button>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
