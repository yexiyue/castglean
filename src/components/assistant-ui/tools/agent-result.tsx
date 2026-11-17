import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { commands, type ResultReference } from "@/lib/bindings";

const labels = {
  pending: msg`待审阅`,
  adopted: msg`已采用`,
  applied: msg`已采用`,
  discarded: msg`已放弃`,
  stale: msg`已失效`,
  published: msg`初稿已保存`,
  saved: msg`建议已保存`,
  unknown: msg`状态未知`,
};

function candidateStatus(status: string, stale: boolean): string {
  // Applicability to the old baseline does not erase a completed human decision.
  return status === "pending" && stale ? "stale" : status;
}

/** Mutable adoption state is queried from the owning domain, never inferred from run success. */
export function AgentResult({
  projectId,
  reference,
  onReview,
  version,
}: {
  projectId: string;
  version?: string;
  reference: ResultReference;
  onReview?: (reference: ResultReference) => void;
}) {
  const { i18n } = useLingui();
  const [status, setStatus] = useState<keyof typeof labels | null>(null);
  const [reading, setReading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const supported = [
    "chapter_analysis",
    "chapter_split_proposal",
    "casting_suggestion",
  ].includes(reference.kind);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Read-again and workspace return revalidate mutable domain state.
  useEffect(() => {
    let live = true;
    setFailed(false);
    setReading(true);
    async function read() {
      if (reference.kind === "chapter_split_proposal") {
        const proposal = await commands.splitProposal(reference.id);
        if (proposal.projectId !== projectId) throw new Error("wrong_project");
        return candidateStatus(proposal.status, proposal.stale);
      }
      if (reference.kind === "chapter_analysis") {
        await commands.chapterAnalysisResultTarget(projectId, reference.id);
        try {
          const candidate = await commands.chapterAnalysisCandidate(
            projectId,
            reference.id,
          );
          return candidateStatus(
            candidate.status,
            candidate.stale || candidate.sourceChanged,
          );
        } catch (error) {
          if (error === "not_found") return "published";
          throw error;
        }
      }
      if (reference.kind === "casting_suggestion") {
        const suggestion = await commands.voiceBindingSuggestion(
          projectId,
          reference.id,
        );
        if (!suggestion) throw new Error("not_found");
        return suggestion.charactersStale || suggestion.catalogStale
          ? "stale"
          : "saved";
      }
      return "unknown";
    }
    if (supported)
      void read()
        .then((value) => {
          if (live)
            setStatus(
              value in labels ? (value as keyof typeof labels) : "unknown",
            );
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
  }, [projectId, reference.id, reference.kind, supported, revision, version]);
  return (
    <div className="space-y-1 text-xs">
      <p className="wrap-anywhere">{reference.summary}</p>
      {status ? (
        <p role="status" className="text-muted-foreground">
          {i18n._(labels[status])}
        </p>
      ) : null}
      {reading && supported ? (
        <p role="status" className="text-muted-foreground">
          <Trans>正在读取结果状态…</Trans>
        </p>
      ) : null}
      {failed ? (
        <p role="alert">
          <Trans>结果状态读取未完成，已有内容可能过时。</Trans>
        </p>
      ) : null}
      {failed ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setRevision((value) => value + 1)}
        >
          <Trans>重新读取结果</Trans>
        </Button>
      ) : supported && onReview ? (
        <Button
          size="sm"
          variant="outline"
          disabled={reading || status === null}
          onClick={() => onReview(reference)}
        >
          <Trans>查看结果与审阅状态</Trans>
        </Button>
      ) : null}
    </div>
  );
}
