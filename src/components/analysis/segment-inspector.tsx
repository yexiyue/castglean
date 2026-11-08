import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { BoundaryEditor } from "@/components/analysis/boundary-editor";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import {
  type AnalysisSnapshot,
  type Attribution,
  type Character,
  commands,
  type Segment,
  type SegmentKind,
} from "@/lib/bindings";

export function SegmentInspector({
  projectId,
  chapterId,
  snapshot,
  segment,
  characters,
  onSaved,
  onBoundarySaved,
  onLocate,
}: {
  projectId: string;
  chapterId: string;
  snapshot: AnalysisSnapshot | null;
  segment: Segment | null;
  characters: Character[];
  onSaved: () => Promise<void>;
  onBoundarySaved: () => Promise<void>;
  onLocate: (range: { start: number; end: number }) => void;
}) {
  const { t } = useLingui();
  const [kind, setKind] = useState<SegmentKind>("speech");
  const [speaker, setSpeaker] = useState("unknown");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [boundaryOpen, setBoundaryOpen] = useState(false);
  const [baseRevision, setBaseRevision] = useState(snapshot?.revision ?? 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A controlled draft only resets when the selected identity changes; background refresh must preserve edits.
  useEffect(() => {
    setBaseRevision(snapshot?.revision ?? 0);
    if (segment) {
      setKind(segment.kind);
      setSpeaker(
        segment.attribution.state === "resolved"
          ? segment.attribution.character_id
          : segment.attribution.state,
      );
    }
    setFailed(false);
    setSaved(false);
  }, [segment?.id]);
  const currentSpeaker =
    segment?.attribution.state === "resolved"
      ? segment.attribution.character_id
      : segment?.attribution.state;
  const hasChanges =
    !!segment &&
    (kind !== segment.kind ||
      (kind !== "narration" && speaker !== currentSpeaker));
  async function save(confirm: boolean) {
    if (!segment || !snapshot || busy) return;
    setBusy(true);
    setFailed(false);
    setSaved(false);
    let attribution: Attribution;
    if (kind === "narration") {
      attribution = { state: "narrator" };
    } else if (
      speaker === "ambiguous" &&
      segment.attribution.state === "ambiguous"
    ) {
      attribution = segment.attribution;
    } else if (speaker === "unknown" || speaker === "narrator") {
      attribution = { state: "unknown" };
    } else {
      attribution = { state: "resolved", character_id: speaker };
    }
    try {
      const result = await commands.chapterAnalysisEdit(
        projectId,
        chapterId,
        crypto.randomUUID(),
        baseRevision,
        { type: "segment", id: segment.id, kind, attribution, confirm },
      );
      await onSaved();
      setBaseRevision(result.revision);
      setSaved(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      {!snapshot?.versionId ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>
              <Trans>尚未分析</Trans>
            </EmptyTitle>
            <EmptyDescription>
              <Trans>分析本章后，点击正文检查类型、人物归属与证据。</Trans>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !segment ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>
              <Trans>选择一段正文</Trans>
            </EmptyTitle>
            <EmptyDescription>
              <Trans>点击标记或待检查位置，查看和修正归属。</Trans>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">
              <Trans>片段归属</Trans>
            </h3>
            <span className="text-muted-foreground text-xs">
              {segment.review === "confirmed" ? t`人工已确认` : t`待审阅`}
            </span>
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="segment-kind">
                <Trans>类型</Trans>
              </FieldLabel>
              <NativeSelect
                id="segment-kind"
                value={kind}
                disabled={busy || snapshot.stale}
                onChange={(e) => setKind(e.target.value as SegmentKind)}
              >
                <option value="narration">{t`旁白`}</option>
                <option value="speech">{t`台词`}</option>
                <option value="thought">{t`内心独白`}</option>
              </NativeSelect>
            </Field>
            {kind !== "narration" ? (
              <Field>
                <FieldLabel htmlFor="segment-speaker">
                  <Trans>说话人</Trans>
                </FieldLabel>
                <NativeSelect
                  id="segment-speaker"
                  value={speaker === "narrator" ? "unknown" : speaker}
                  disabled={busy || snapshot.stale}
                  onChange={(e) => setSpeaker(e.target.value)}
                >
                  <option value="unknown">{t`未知`}</option>
                  {segment.attribution.state === "ambiguous" ? (
                    <option value="ambiguous">{t`保留歧义`}</option>
                  ) : null}
                  {characters
                    .filter(
                      (c) =>
                        c.status === "confirmed" ||
                        c.origin.chapterId === chapterId,
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.displayName}
                        {c.status === "candidate" ? ` · ${t`候选`}` : ""}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
            ) : null}
          </FieldGroup>
          {segment.attribution.state === "ambiguous" ? (
            <p className="text-muted-foreground text-sm">
              {segment.attribution.character_ids
                .map(
                  (id) =>
                    characters.find((c) => c.id === id)?.displayName ?? t`未知`,
                )
                .join("、")}
            </p>
          ) : null}
          <p className="text-muted-foreground text-sm leading-6">
            {segment.reason}
          </p>
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-medium">
              <Trans>原文证据</Trans>
            </h4>
            {segment.evidence.map((e) => (
              <Button
                key={`${e.range.start}:${e.range.end}:${e.reason}`}
                variant="ghost"
                size="sm"
                className="h-auto justify-start py-2 text-left whitespace-normal"
                onClick={() => onLocate(e.range)}
              >
                {e.reason}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={
                busy ||
                snapshot.stale ||
                (!hasChanges && segment.review === "confirmed")
              }
              onClick={() => void save(true)}
            >
              <Trans>保存并确认</Trans>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || snapshot.stale || !hasChanges}
              onClick={() => void save(false)}
            >
              <Trans>保存修改</Trans>
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            disabled={busy || snapshot.stale}
            onClick={() => setBoundaryOpen(true)}
          >
            <Trans>调整片段边界</Trans>
          </Button>
          <BoundaryEditor
            open={boundaryOpen}
            onOpenChange={setBoundaryOpen}
            projectId={projectId}
            chapterId={chapterId}
            segment={segment}
            snapshot={snapshot}
            onSaved={onBoundarySaved}
          />
          {failed ? (
            <p role="alert" className="text-destructive text-sm">
              <Trans>未能确认保存结果，修改仍保留。请重新读取后核对。</Trans>
            </p>
          ) : null}
          {failed ? (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void commands
                  .chapterAnalysisSnapshot(projectId, chapterId)
                  .then(async (fresh) => {
                    await onSaved();
                    setBaseRevision(fresh.revision);
                    setFailed(false);
                  })
                  .catch(() => setFailed(true))
                  .finally(() => setBusy(false));
              }}
            >
              <Trans>重新读取</Trans>
            </Button>
          ) : null}
          {saved ? (
            <p role="status" className="text-muted-foreground text-xs">
              <Trans>已保存</Trans>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
