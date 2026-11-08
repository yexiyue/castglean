import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { AuxiliaryDialog } from "@/components/auxiliary-dialog";
import { Button } from "@/components/ui/button";
import {
  commands,
  type LocalProjectSnapshot_Serialize,
  type ProposalInfo_Serialize,
  type ResultReference,
} from "@/lib/bindings";
import { chapterChanges } from "@/lib/projects/split-review";

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
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [offset, setOffset] = useState(0);
  const requests = useRef(new Map<string, string>());
  // Revision and explicit reload must re-read mutable proposal status.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Revalidate status when the project changes or the user reloads.
  useEffect(() => {
    let active = true;
    setProposal(null);
    setOffset(0);
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
  const changes = chapterChanges(
    project.chapters,
    proposal.content.chapters,
    project.volumes,
    proposal.content.volumes,
  );
  const visible = onlyChanges
    ? changes.filter((change) => change.kind !== "unchanged")
    : changes;
  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const change of changes) counts[change.kind]++;
  const labels = {
    added: t({ message: "新增", comment: "候选目录中新增的章节起点" }),
    removed: t({ message: "移除", comment: "候选目录移除当前章节起点" }),
    changed: t({ message: "调整", comment: "章节标题、范围或所属分卷改变" }),
    unchanged: t({
      message: "未变化",
      comment: "当前目录与候选目录中相同的章节",
    }),
  };
  const status =
    proposal.status === "adopted"
      ? t`已采用`
      : proposal.status === "discarded"
        ? t`已放弃`
        : stale
          ? t`已过期`
          : t`待审阅`;
  return (
    <section
      aria-label={t`候选分章方案`}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <div className="shrink-0 space-y-2 border-b p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">
            <Trans>候选分章方案</Trans>
          </h2>
          <span role="status" className="text-muted-foreground text-xs">
            {status}
          </span>
        </div>
        <p className="text-muted-foreground text-xs">
          <Trans>
            新增 {counts.added} · 移除 {counts.removed} · 调整 {counts.changed}
          </Trans>
        </p>
        {stale && proposal.status === "pending" ? (
          <p className="text-warning text-sm">
            <Trans>目录已变化，此方案已过期。请让助手重新检查。</Trans>
          </p>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyChanges}
            onChange={(event) => {
              setOnlyChanges(event.target.checked);
              setOffset(0);
            }}
          />
          <Trans>仅看变化</Trans>
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="bg-muted/30 text-muted-foreground grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-b px-4 py-2 text-xs">
          <span>
            <Trans>当前目录</Trans>
          </span>
          <span>
            <Trans>建议目录</Trans>
          </span>
        </div>
        {!visible.length ? (
          <p className="text-muted-foreground p-4 text-sm">
            <Trans>没有章节结构变化，可查看完整目录或分章规则。</Trans>
          </p>
        ) : null}
        {visible.slice(offset, offset + 50).map((change) => {
          const chapter = change.chapter;
          const filename = project.sources.find(
            (source) => source.id === chapter.sourceId,
          )?.filename;
          return (
            <button
              key={change.key}
              type="button"
              className="hover:bg-muted/40 block w-full space-y-2 border-b px-4 py-3 text-left"
              onClick={() => onLocate(chapter.sourceId, chapter.heading ?? 0)}
            >
              <span className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={
                    change.kind === "removed"
                      ? "text-destructive"
                      : change.kind === "added"
                        ? "text-success"
                        : "text-muted-foreground"
                  }
                >
                  {labels[change.kind]}
                </span>
                <span className="text-muted-foreground break-all">
                  {filename} · <Trans>第 {(chapter.heading ?? 0) + 1} 行</Trans>
                </span>
              </span>
              <span className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 text-sm">
                <span className="min-w-0 wrap-break-word">
                  {change.before?.title ?? "—"}
                </span>
                <span className="min-w-0 wrap-break-word">
                  {change.after?.title ?? "—"}
                </span>
              </span>
              {change.before &&
              change.after &&
              change.before.end !== change.after.end ? (
                <span className="text-muted-foreground block text-xs">
                  <Trans>章节结束位置已调整</Trans>
                </span>
              ) : null}
              {change.before && change.after ? (
                <span className="text-muted-foreground grid grid-cols-2 gap-4 text-xs">
                  <span>
                    {
                      project.volumes.find(
                        (volume) => volume.id === change.before?.volumeId,
                      )?.title
                    }
                  </span>
                  <span>
                    {
                      proposal.content.volumes.find(
                        (volume) => volume.id === change.after?.volumeId,
                      )?.title
                    }
                  </span>
                </span>
              ) : null}
              <span className="text-muted-foreground block text-xs">
                <Trans>查看原文上下文</Trans>
              </span>
            </button>
          );
        })}
        {visible.length > 50 ? (
          <div className="flex items-center gap-2 p-4">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset((value) => Math.max(0, value - 50))}
            >
              <Trans>上一页</Trans>
            </Button>
            <span className="text-xs">
              {Math.floor(offset / 50) + 1} / {Math.ceil(visible.length / 50)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + 50 >= visible.length}
              onClick={() => setOffset((value) => value + 50)}
            >
              <Trans>下一页</Trans>
            </Button>
          </div>
        ) : null}
        <AuxiliaryDialog
          title={
            <>
              {" "}
              <Trans>分章规则</Trans>{" "}
            </>
          }
        >
          <pre className="mt-2 overflow-auto text-xs whitespace-pre-wrap">
            {proposal.content.rules
              .map((rule) => `${rule.name}: ${rule.pattern}`)
              .join("\n")}
          </pre>
        </AuxiliaryDialog>
      </div>
      <div className="shrink-0 space-y-2 border-t p-4">
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            <Trans>方案状态未能保存，请重新读取并检查工程修订。</Trans>
          </p>
        ) : null}
        {proposal.status === "pending" && (
          <p className="text-warning text-xs">
            <Trans>
              采用目录后，边界变化可能使相关分析失效；历史与人工记录保留，不会自动迁移。
            </Trans>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              disabled || busy || stale || proposal.status !== "pending"
            }
            onClick={() => void decide("adopt")}
          >
            <Trans>采用整套方案</Trans>
          </Button>
          <Button
            variant="outline"
            disabled={disabled || busy || proposal.status !== "pending"}
            onClick={() => void decide("discard")}
          >
            <Trans>放弃方案</Trans>
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            <Trans>重新读取</Trans>
          </Button>
        </div>
      </div>
    </section>
  );
}
