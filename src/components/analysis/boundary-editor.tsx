import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
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
  type Edit as AnalysisEdit,
  type AnalysisSnapshot,
  commands,
  type Excerpt,
  type Segment,
} from "@/lib/bindings";

const boundarySchema = z.object({ offset: z.number().int().nonnegative() });

export function BoundaryEditor({
  open,
  onOpenChange,
  projectId,
  chapterId,
  segment,
  snapshot,
  onSaved,
  onPendingChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  chapterId: string;
  segment: Segment;
  snapshot: AnalysisSnapshot;
  onSaved: () => Promise<void>;
  onPendingChange: (pending: boolean) => void;
}) {
  const mode = useWorkspaceMode();
  const initial = useRef({ snapshot, segment });
  const { t } = useLingui();
  const formId = useId();
  const [excerpt, setExcerpt] = useState<Excerpt | null>(null);
  const [next, setNext] = useState<Segment | null>(null);
  const form = useForm({
    resolver: zodResolver(boundarySchema),
    defaultValues: { offset: 0 },
  });
  const offset = form.watch("offset");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [rejected, setRejected] = useState(false);
  const pending = useRef(false);
  const operation = useRef<{
    projectId: string;
    chapterId: string;
    commandId: string;
    revision: number;
    edit: AnalysisEdit;
    confirmed: boolean;
  } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Keep the original revision and source snapshot while this controlled editor is open.
  useEffect(() => {
    if (!open) return;
    initial.current = { snapshot, segment };
    let live = true;
    setExcerpt(null);
    setNext(null);
    form.reset({ offset: 0 });
    setFailed(false);
    setConfirmed(false);
    setRejected(false);
    operation.current = null;
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
    initial.current.segment.range.start +
    new TextEncoder().encode(excerpt?.text.slice(0, utf16) ?? "").length;
  async function apply(merge: boolean) {
    if (!excerpt || pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    setRejected(false);
    try {
      const original = initial.current.segment;
      const range =
        merge && next
          ? { start: original.range.start, end: next.range.end }
          : original.range;
      const segments = merge
        ? [
            {
              ...original,
              range,
              evidence: [...original.evidence, ...(next?.evidence ?? [])].slice(
                0,
                8,
              ),
            },
          ]
        : [
            { ...original, range: { start: original.range.start, end: byte } },
            { ...original, range: { start: byte, end: original.range.end } },
          ];
      const request = operation.current ?? {
        projectId,
        chapterId,
        commandId: crypto.randomUUID(),
        revision: initial.current.snapshot.revision,
        edit: { type: "replace", range, segments } as AnalysisEdit,
        confirmed: false,
      };
      operation.current = request;
      onPendingChange(true);
      if (!request.confirmed) {
        try {
          await commands.chapterAnalysisEdit(
            request.projectId,
            request.chapterId,
            request.commandId,
            request.revision,
            request.edit,
          );
        } catch (cause) {
          setRejected(
            typeof cause === "string" &&
              [
                "conflict",
                "analysis_conflict",
                "analysis_source_changed",
                "analysis_invalid_data",
                "analysis_not_found",
                "analysis_capacity_exceeded",
              ].includes(cause),
          );
          throw cause;
        }
        request.confirmed = true;
        setConfirmed(true);
      }
      await onSaved();
      operation.current = null;
      onPendingChange(false);
      onOpenChange(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      pending.current = false;
    }
  }
  return (
    <Dialog
      open={open && (mode?.active ?? true)}
      onOpenChange={(next) => {
        if (next || (!pending.current && !operation.current))
          onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={!busy && !operation.current}>
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
          <FieldLabel htmlFor={`${formId}-boundary-source`}>
            <Trans>在原文中点击拆分位置，也可使用方向键定位</Trans>
          </FieldLabel>
          <Textarea
            id={`${formId}-boundary-source`}
            aria-label={t`原文中的拆分位置`}
            readOnly
            value={excerpt?.text ?? ""}
            className="max-h-64 min-h-32 leading-7"
            onSelect={(e) => {
              if (!operation.current)
                form.setValue("offset", e.currentTarget.selectionStart);
            }}
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
              !!operation.current ||
              byte <= initial.current.segment.range.start ||
              byte >= initial.current.segment.range.end
            }
            onClick={() => void apply(false)}
          >
            <Trans>在光标处拆分</Trans>
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !!operation.current || !next}
            onClick={() => void apply(true)}
          >
            <Trans>与下一片段合并</Trans>
          </Button>
        </div>
        {failed ? (
          <p role="alert" className="text-destructive text-sm">
            {!operation.current ? (
              <Trans>无法读取片段，请关闭后重试。</Trans>
            ) : confirmed ? (
              <Trans>修改已保存，结果读取失败。</Trans>
            ) : (
              <Trans>操作结果尚未确认，原始范围和请求已保留。</Trans>
            )}
          </p>
        ) : null}
        {failed && operation.current && (
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void apply(false)}>
              {confirmed ? t`重新读取结果` : t`重试原操作`}
            </Button>
            {rejected && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    try {
                      await onSaved();
                      operation.current = null;
                      onPendingChange(false);
                      onOpenChange(false);
                    } catch {
                      setFailed(true);
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              >
                <Trans>重新读取并放弃本次调整</Trans>
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
