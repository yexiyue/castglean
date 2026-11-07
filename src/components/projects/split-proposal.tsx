import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { ProposalDirectory } from "@/components/projects/proposal-directory";
import { Button } from "@/components/ui/button";
import {
  commands,
  type LocalProjectSnapshot_Serialize,
  type ProposalInfo_Serialize,
  type ResultReference,
} from "@/lib/bindings";

export function SplitProposal({
  reference,
  project,
  disabled,
  onChange,
  onLocate,
}: {
  reference: ResultReference;
  project: LocalProjectSnapshot_Serialize;
  disabled: boolean;
  onChange: (project: LocalProjectSnapshot_Serialize) => void;
  onLocate: (sourceId: string, line: number) => void;
}) {
  const { t } = useLingui();
  const [proposal, setProposal] = useState<ProposalInfo_Serialize | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const requests = useRef(new Map<string, string>());
  // Revision and explicit reload must re-read mutable proposal status.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Revalidate status when the project changes or the user reloads.
  useEffect(() => {
    let active = true;
    setProposal(null);
    setError(false);
    if (reference.kind !== "chapter_split_proposal") return;
    void commands
      .splitProposal(reference.id)
      .then((next) => {
        if (active && next.projectId === project.id) setProposal(next);
        else if (active) setError(true);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [reference.id, reference.kind, project.id, project.revision, refresh]);
  if (reference.kind !== "chapter_split_proposal")
    return (
      <p className="text-muted-foreground text-xs">
        {reference.summary} <Trans>此结果暂不支持预览。</Trans>
      </p>
    );
  if (!proposal)
    return (
      <div className="border-t pt-3 text-sm">
        {error ? (
          <>
            <p role="alert">
              <Trans>无法读取方案，原记录仍保留。</Trans>
            </p>
            <Button
              variant="ghost"
              onClick={() => setRefresh((value) => value + 1)}
            >
              <Trans>重新读取</Trans>
            </Button>
          </>
        ) : (
          <Trans>正在读取方案…</Trans>
        )}
      </div>
    );
  const stale = proposal.stale || proposal.baseRevision !== project.revision;
  async function decide(action: "adopt" | "discard") {
    setBusy(true);
    setError(false);
    const key = `${reference.id}:${action}`;
    let id = requests.current.get(key);
    if (!id) {
      id = crypto.randomUUID();
      requests.current.set(key, id);
    }
    try {
      if (action === "adopt") await commands.splitAdopt(reference.id, id);
      else await commands.splitDiscard(reference.id, id);
      const next = await commands.localProjectSnapshot(project.id);
      onChange(next);
      setRefresh((value) => value + 1);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-medium">
        <Trans>候选分章方案</Trans> · {proposal.content.chapters.length}
      </h3>
      <p className="text-muted-foreground text-xs">
        <Trans>
          新增 {proposal.content.addedLines.length} 个起点，移除{" "}
          {proposal.content.removedLines.length} 个起点。
        </Trans>
      </p>
      <ProposalDirectory
        chapters={proposal.content.chapters}
        onLocate={onLocate}
      />
      <details>
        <summary className="cursor-pointer text-sm">
          <Trans>分章规则</Trans>
        </summary>
        <pre className="max-h-48 overflow-auto text-xs whitespace-pre-wrap">
          {proposal.content.rules
            .map((rule) => `${rule.name}: ${rule.pattern}`)
            .join("\n")}
        </pre>
      </details>
      {stale && proposal.status === "pending" ? (
        <p className="text-muted-foreground text-xs">
          <Trans>草案已变化，此方案已过期。</Trans>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          <Trans>方案状态未能保存，请重新读取并检查工程修订。</Trans>
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          disabled={disabled || busy || stale || proposal.status !== "pending"}
          onClick={() => void decide("adopt")}
        >
          {proposal.status === "adopted" ? t`已采用` : t`采用方案`}
        </Button>
        <Button
          variant="ghost"
          disabled={disabled || busy || proposal.status !== "pending"}
          onClick={() => void decide("discard")}
        >
          {proposal.status === "discarded" ? t`已放弃` : t`放弃方案`}
        </Button>
        {error ? (
          <Button
            variant="ghost"
            onClick={() => setRefresh((value) => value + 1)}
          >
            <Trans>重新读取</Trans>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
