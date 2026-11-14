import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  type Candidate,
  type Character,
  commands,
  type Segment,
} from "@/lib/bindings";
import type { CandidateOperationRegistry } from "@/lib/candidate-operations";

const selectionSchema = z.object({ selected: z.array(z.string()) });

export function CandidateReview({
  projectId,
  chapterId,
  candidateId,
  revision,
  onSaved,
  onLocate,
  characters,
  operations,
}: {
  projectId: string;
  chapterId: string;
  candidateId: string;
  revision: number;
  onSaved: () => Promise<void>;
  onLocate: (range: { start: number; end: number }) => void;
  characters: Character[];
  operations: CandidateOperationRegistry;
}) {
  const { t } = useLingui();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const form = useForm({
    resolver: zodResolver(selectionSchema),
    defaultValues: { selected: [] as string[] },
  });
  const selected = form.watch("selected");
  const operationKey = JSON.stringify([projectId, candidateId]);
  useSyncExternalStore(
    operations.subscribe,
    operations.snapshot,
    operations.snapshot,
  );
  const activeOperation = operations.entries.get(operationKey);
  const pending = !!activeOperation;
  const [reloadKey, setReloadKey] = useState(0);
  const [localBusy, setBusy] = useState(false);
  const busy = localBusy || !!activeOperation?.inFlight;
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void reloadKey;
    setCandidate(null);
    setLoadFailed(false);
    void commands
      .chapterAnalysisCandidate(projectId, candidateId)
      .then((c) => {
        if (active) {
          setCandidate(c);
          form.reset({
            selected:
              operations.entries.get(operationKey)?.selected ??
              c.differences.filter((d) => !d.conflict).map((d) => d.id),
          });
        }
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [projectId, candidateId, reloadKey, form.reset, operations, operationKey]);
  async function process(discard: boolean) {
    let operation = operations.entries.get(operationKey);
    if (!operation) {
      if (!candidate) return;
      operation = {
        projectId,
        chapterId,
        candidateId: candidate.id,
        commandId: crypto.randomUUID(),
        revision,
        selected: discard ? null : [...selected],
        conflicts: discard
          ? []
          : candidate.differences
              .filter((group) => group.conflict && selected.includes(group.id))
              .map((group) => group.id),
        phase: "write",
        inFlight: false,
        rejected: false,
        failed: false,
      };
      operations.entries.set(operationKey, operation);
    }
    if (operation.inFlight) return;
    operation.inFlight = true;
    operation.failed = false;
    operations.notify();
    setBusy(true);
    try {
      if (operation.phase === "write") {
        try {
          await commands.chapterAnalysisCandidateProcess(
            operation.projectId,
            operation.candidateId,
            operation.commandId,
            operation.revision,
            operation.selected,
            operation.conflicts,
          );
        } catch (cause) {
          operation.rejected =
            typeof cause === "string" &&
            [
              "conflict",
              "analysis_conflict",
              "analysis_source_changed",
              "analysis_invalid_data",
              "analysis_not_found",
              "analysis_capacity_exceeded",
            ].includes(cause);
          throw cause;
        }
        operation.phase = "read";
      }
      await onSaved();
      operations.entries.delete(operationKey);
    } catch {
      operation.failed = true;
    } finally {
      operation.inFlight = false;
      operations.notify();
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
    <form
      className="flex flex-col gap-3 p-4"
      onSubmit={form.handleSubmit(() => void process(false))}
    >
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
      {loadFailed && !candidate ? (
        <Button
          type="button"
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
      <Controller
        control={form.control}
        name="selected"
        render={({ field }) => (
          <>
            {candidate?.differences.map((g, index) => (
              <div key={g.id} className="flex flex-col gap-2 border-b pb-3">
                <label
                  htmlFor={`difference-${g.id}`}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    id={`difference-${g.id}`}
                    aria-label={
                      g.conflict
                        ? t`第 ${index + 1} 项：人工修改冲突`
                        : t`第 ${index + 1} 项：归属或边界变化`
                    }
                    checked={field.value.includes(g.id)}
                    disabled={
                      busy ||
                      pending ||
                      candidate.stale ||
                      candidate.status !== "pending"
                    }
                    onCheckedChange={(v) =>
                      field.onChange(
                        v
                          ? [...field.value, g.id]
                          : field.value.filter((id) => id !== g.id),
                      )
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
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => onLocate(g.range)}
                >
                  <Trans>查看原文</Trans>
                </Button>
              </div>
            ))}
          </>
        )}
      />
      {candidate?.differences.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          <Trans>没有类型、归属或边界变化。</Trans>
        </p>
      ) : null}
      {candidate?.status === "pending" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={busy || pending || candidate.stale}
          >
            <Trans>应用所选变化</Trans>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || pending}
            onClick={() => void process(true)}
          >
            <Trans>放弃候选</Trans>
          </Button>
        </div>
      ) : null}
      {activeOperation?.failed ? (
        <div role="alert" className="text-destructive space-y-2 text-sm">
          <p>
            {operations.entries.get(operationKey)?.phase === "read" ? (
              <Trans>操作已保存，结果读取失败。</Trans>
            ) : (
              <Trans>操作结果尚未确认，所选范围已保留。</Trans>
            )}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void process(false)}
          >
            {operations.entries.get(operationKey)?.phase === "read"
              ? t`重新读取结果`
              : t`重试原操作`}
          </Button>
          {operations.entries.get(operationKey)?.rejected && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  try {
                    await onSaved();
                    operations.entries.delete(operationKey);
                    operations.notify();
                  } finally {
                    setBusy(false);
                  }
                })().catch(() => {})
              }
            >
              <Trans>重新读取并放弃本次选择</Trans>
            </Button>
          )}
        </div>
      ) : null}
    </form>
  );
}
