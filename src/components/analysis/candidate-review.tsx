import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  type Candidate,
  type Character,
  commands,
  type Segment,
} from "@/lib/bindings";

export function CandidateReview({
  projectId,
  candidateId,
  revision,
  onSaved,
  onLocate,
  characters,
}: {
  projectId: string;
  candidateId: string;
  revision: number;
  onSaved: () => Promise<void>;
  onLocate: (range: { start: number; end: number }) => void;
  characters: Character[];
}) {
  const { t } = useLingui();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void reloadKey;
    setCandidate(null);
    setFailed(false);
    void commands
      .chapterAnalysisCandidate(projectId, candidateId)
      .then((c) => {
        if (active) {
          setCandidate(c);
          setSelected(
            new Set(c.differences.filter((d) => !d.conflict).map((d) => d.id)),
          );
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [projectId, candidateId, reloadKey]);
  async function process(discard: boolean) {
    if (!candidate) return;
    setBusy(true);
    setFailed(false);
    try {
      await commands.chapterAnalysisCandidateProcess(
        projectId,
        candidate.id,
        crypto.randomUUID(),
        revision,
        discard ? null : [...selected],
        discard
          ? []
          : candidate.differences
              .filter((g) => g.conflict && selected.has(g.id))
              .map((g) => g.id),
      );
      await onSaved();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  function kindLabel(kind: Segment["kind"]) {
    switch (kind) {
      case "narration":
        return t`旁白`;
      case "thought":
        return t`内心独白`;
      case "speech":
        return t`台词`;
    }
  }
  function speakerLabel(attribution: Segment["attribution"]) {
    const name = (id: string) =>
      characters.find((c) => c.id === id)?.displayName ?? t`未知`;
    switch (attribution.state) {
      case "narrator":
        return t`旁白`;
      case "unknown":
        return t`未知`;
      case "ambiguous":
        return attribution.character_ids.map(name).join(" / ");
      case "resolved":
        return name(attribution.character_id);
    }
  }
  function summary(segments: Segment[]) {
    return segments
      .map((s) => `${kindLabel(s.kind)} · ${speakerLabel(s.attribution)}`)
      .join("；");
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-medium">
        <Trans>重新分析的变化</Trans>
      </h3>
      <p className="text-muted-foreground text-xs">
        <Trans>
          未选范围保留当前结果。勾选冲突表示允许替换该范围的人工修改。
        </Trans>
      </p>
      {candidate?.sourceChanged ? (
        <p role="alert" className="text-warning text-xs">
          <Trans>
            章节范围已变化，此候选需整章采用。旧分析与人工记录保留在历史中，不能撤回为已失效范围。
          </Trans>
        </p>
      ) : null}
      {failed && !candidate ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setReloadKey((n) => n + 1)}
        >
          <Trans>重试读取</Trans>
        </Button>
      ) : null}
      {candidate?.stale ? (
        <p role="alert" className="text-warning text-sm">
          <Trans>当前内容已变化，此候选不能应用。</Trans>
        </p>
      ) : null}
      {candidate?.differences.map((g) => (
        <div key={g.id} className="flex flex-col gap-2 border-b pb-3">
          <label
            htmlFor={`difference-${g.id}`}
            className="flex items-center gap-2 text-sm"
          >
            <Checkbox
              id={`difference-${g.id}`}
              checked={selected.has(g.id)}
              disabled={
                busy || candidate.stale || candidate.status !== "pending"
              }
              onCheckedChange={(v) =>
                setSelected((old) => {
                  const next = new Set(old);
                  if (v) next.add(g.id);
                  else next.delete(g.id);
                  return next;
                })
              }
            />
            {g.conflict ? (
              <Trans>人工修改冲突</Trans>
            ) : (
              <Trans>归属或边界变化</Trans>
            )}
          </label>
          <p className="text-muted-foreground text-xs">
            {summary(g.current)} → {summary(g.suggested)}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => onLocate(g.range)}
          >
            <Trans>查看原文</Trans>
          </Button>
        </div>
      ))}
      {candidate?.differences.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          <Trans>没有类型、归属或边界变化。</Trans>
        </p>
      ) : null}
      {candidate?.status === "pending" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || candidate.stale}
            onClick={() => void process(false)}
          >
            <Trans>应用所选变化</Trans>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void process(true)}
          >
            <Trans>放弃候选</Trans>
          </Button>
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className="text-destructive text-sm">
          <Trans>操作未保存，请刷新后重试。已有结果保留。</Trans>
        </p>
      ) : null}
    </div>
  );
}
