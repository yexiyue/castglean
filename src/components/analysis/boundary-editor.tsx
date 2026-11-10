import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { useWorkspaceMode } from "@/components/projects/workspace-mode";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  type AnalysisSnapshot,
  commands,
  type Excerpt,
  type Segment,
} from "@/lib/bindings";

export function BoundaryEditor({
  open,
  onOpenChange,
  projectId,
  chapterId,
  segment,
  snapshot,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  chapterId: string;
  segment: Segment;
  snapshot: AnalysisSnapshot;
  onSaved: () => Promise<void>;
}) {
  const mode = useWorkspaceMode();
  const initial = useRef({ snapshot, segment });
  const { t } = useLingui();
  const [excerpt, setExcerpt] = useState<Excerpt | null>(null);
  const [next, setNext] = useState<Segment | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Keep the original revision and source snapshot while this controlled editor is open.
  useEffect(() => {
    if (!open) return;
    initial.current = { snapshot, segment };
    let live = true;
    setExcerpt(null);
    setNext(null);
    setOffset(0);
    setFailed(false);
    void Promise.all([
      commands.chapterAnalysisExcerpt(projectId, chapterId, segment.range),
      commands.chapterAnalysisSegments(
        projectId,
        snapshot.versionId ?? "",
        { start: segment.range.start, end: snapshot.binding.end },
        null,
      ),
    ])
      .then(([e, page]) => {
        if (live) {
          setExcerpt(e);
          setNext(
            page.segments.find((s) => s.range.start === segment.range.end) ??
              null,
          );
        }
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [open, projectId, chapterId, segment.id]);
  let utf16 = offset;
  if (excerpt && utf16 > 0 && utf16 < excerpt.text.length) {
    const before = excerpt.text.charCodeAt(utf16 - 1),
      after = excerpt.text.charCodeAt(utf16);
    if (
      before >= 0xd800 &&
      before <= 0xdbff &&
      after >= 0xdc00 &&
      after <= 0xdfff
    )
      utf16--;
  }
  const byte =
    segment.range.start +
    new TextEncoder().encode(excerpt?.text.slice(0, utf16) ?? "").length;
  async function apply(merge: boolean) {
    if (!excerpt || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const range =
        merge && next
          ? { start: segment.range.start, end: next.range.end }
          : segment.range;
      const segments = merge
        ? [
            {
              ...segment,
              range,
              evidence: [...segment.evidence, ...(next?.evidence ?? [])].slice(
                0,
                8,
              ),
            },
          ]
        : [
            { ...segment, range: { start: segment.range.start, end: byte } },
            { ...segment, range: { start: byte, end: segment.range.end } },
          ];
      await commands.chapterAnalysisEdit(
        projectId,
        chapterId,
        crypto.randomUUID(),
        initial.current.snapshot.revision,
        { type: "replace", range, segments },
      );
      await onSaved();
      onOpenChange(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open && (mode?.active ?? true)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>调整片段边界</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              只调整标注范围，不修改原文。拆分或合并后沿用当前片段的类型和归属，再分别检查。
            </Trans>
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="boundary-source">
            <Trans>在原文中点击拆分位置，也可使用方向键定位</Trans>
          </FieldLabel>
          <Textarea
            id="boundary-source"
            aria-label={t`原文中的拆分位置`}
            readOnly
            value={excerpt?.text ?? ""}
            className="max-h-64 min-h-32 leading-7"
            onSelect={(e) => setOffset(e.currentTarget.selectionStart)}
          />
        </Field>
        {excerpt?.truncated ? (
          <p className="text-muted-foreground text-xs">
            <Trans>此处显示片段开头，后续原文保留。</Trans>
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={
              busy ||
              !excerpt ||
              byte <= segment.range.start ||
              byte >= segment.range.end
            }
            onClick={() => void apply(false)}
          >
            <Trans>在光标处拆分</Trans>
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !next}
            onClick={() => void apply(true)}
          >
            <Trans>与下一片段合并</Trans>
          </Button>
        </div>
        {failed ? (
          <p role="alert" className="text-destructive text-sm">
            <Trans>操作未保存，请刷新后重试。已有结果保留。</Trans>
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
