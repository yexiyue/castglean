import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
import { type JSX, useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import type { SegmentEditDrafts } from "@/hooks/use-segment-edit-drafts";
import {
  type AnalysisSnapshot,
  type Attribution,
  type Character,
  commands,
  type Segment,
  type SegmentKind,
} from "@/lib/bindings";

const segmentSchema = z.object({
  kind: z.enum(["narration", "speech", "thought"]),
  speaker: z.string(),
});

interface SegmentInspectorProps {
  edits: SegmentEditDrafts;
  projectId: string;
  chapterId: string;
  snapshot: AnalysisSnapshot | null;
  segment: Segment | null;
  characters: Character[];
  onSaved: () => Promise<void>;
  onEditBoundary: (segment: Segment, snapshot: AnalysisSnapshot) => void;
  onLocate: (range: { start: number; end: number }) => void;
}

function attributionFor(
  kind: SegmentKind,
  speaker: string,
  current: Attribution,
): Attribution {
  if (kind === "narration") return { state: "narrator" };
  if (speaker === "ambiguous" && current.state === "ambiguous") return current;
  if (speaker === "unknown" || speaker === "narrator")
    return { state: "unknown" };
  return { state: "resolved", character_id: speaker };
}

export function SegmentInspector(props: SegmentInspectorProps): JSX.Element {
  return (
    <SegmentProperties
      key={`${props.chapterId}:${props.segment?.id ?? "none"}`}
      {...props}
    />
  );
}

function SegmentProperties({
  edits,
  projectId,
  chapterId,
  snapshot,
  segment,
  characters,
  onSaved,
  onEditBoundary,
  onLocate,
}: SegmentInspectorProps): JSX.Element {
  const { t } = useLingui();
  const key = `${projectId}:${chapterId}:${segment?.id ?? "none"}`;
  const {
    draft,
    status: saveStatus,
    retry,
    confirmed,
  } = edits.states[key] ?? edits.empty;
  const busy = saveStatus === "saving";
  const failed = saveStatus === "failed";
  const { setDraft: updateDraft, persist: save } = edits;
  function setDraft(value: typeof draft): void {
    updateDraft(key, value);
  }
  function persist(
    action: () => Promise<void>,
    read?: () => Promise<void>,
  ): Promise<void> {
    return save(key, action, read);
  }
  const kind = draft?.kind ?? segment?.kind ?? "speech";
  const speaker =
    draft?.speaker ??
    (segment?.attribution.state === "resolved"
      ? segment.attribution.character_id
      : (segment?.attribution.state ?? "unknown"));
  const form = useForm({
    resolver: zodResolver(segmentSchema),
    values: { kind, speaker },
  });
  // The snapshot and the paged segments arrive separately. Keep the saved choice
  // visible until its authoritative segment reaches the reader.
  useEffect(() => {
    if (!draft || busy || failed || !segment) return;
    const current =
      segment.attribution.state === "resolved"
        ? segment.attribution.character_id
        : segment.attribution.state;
    if (
      segment.kind === draft.kind &&
      (draft.kind === "narration" || current === draft.speaker)
    )
      updateDraft(key, null);
  }, [draft, busy, failed, segment, updateDraft, key]);
  function change(nextKind: SegmentKind, nextSpeaker: string) {
    if (!segment || !snapshot || busy || failed || edits.isPending(key)) return;
    const attribution = attributionFor(
      nextKind,
      nextSpeaker,
      segment.attribution,
    );
    setDraft({ kind: nextKind, speaker: nextSpeaker });
    edits.setTarget(key, { projectId, chapterId, segment });
    edits.setConfirmed(key, false);
    let commandId = crypto.randomUUID(),
      revision = snapshot.revision;
    let conflict = false;
    let confirmed = false;
    void persist(async () => {
      if (conflict) {
        const fresh = await commands.chapterAnalysisSnapshot(
          projectId,
          chapterId,
        );
        revision = fresh.revision;
        commandId = crypto.randomUUID();
        conflict = false;
      }
      try {
        if (!confirmed)
          await commands.chapterAnalysisEdit(
            projectId,
            chapterId,
            commandId,
            revision,
            {
              type: "segment",
              id: segment.id,
              kind: nextKind,
              attribution,
              confirm: true,
            },
          );
        confirmed = true;
        edits.setConfirmed(key, true);
      } catch (cause) {
        conflict = cause === "conflict" || cause === "analysis_conflict";
        throw cause;
      }
    }, onSaved);
  }
  let statusLabel = segment?.review === "confirmed" ? t`人工修改` : t`AI 分析`;
  if (saveStatus === "saving") statusLabel = t`正在保存…`;
  else if (saveStatus === "failed") statusLabel = t`保存未完成`;
  else if (saveStatus === "saved") statusLabel = t`已保存`;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      {segment && snapshot?.versionId ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">
              <Trans comment="所选小说片段的角色属性">角色归属</Trans>
            </h3>
            <span className="text-muted-foreground text-xs" role="status">
              {statusLabel}
            </span>
          </div>
          <FieldGroup>
            <Controller
              control={form.control}
              name="kind"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="segment-kind">
                    <Trans>类型</Trans>
                  </FieldLabel>
                  <NativeSelect
                    {...field}
                    id="segment-kind"
                    disabled={busy || failed || snapshot.stale}
                    onChange={(e) => {
                      if (edits.isPending(key)) return;
                      field.onChange(e);
                      change(e.target.value as SegmentKind, speaker);
                    }}
                  >
                    <option value="narration">{t`旁白`}</option>
                    <option value="speech">{t`台词`}</option>
                    <option value="thought">{t`内心独白`}</option>
                  </NativeSelect>
                  <FieldDescription>
                    <Trans>更改后立即保存。</Trans>
                  </FieldDescription>
                </Field>
              )}
            />
            {kind !== "narration" && (
              <Controller
                control={form.control}
                name="speaker"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="segment-speaker">
                      <Trans>说话人</Trans>
                    </FieldLabel>
                    <NativeSelect
                      {...field}
                      id="segment-speaker"
                      value={
                        field.value === "narrator" ? "unknown" : field.value
                      }
                      disabled={busy || failed || snapshot.stale}
                      onChange={(e) => {
                        if (edits.isPending(key)) return;
                        field.onChange(e);
                        change(kind, e.target.value);
                      }}
                    >
                      <option value="unknown">{t`未知`}</option>
                      {segment.attribution.state === "ambiguous" && (
                        <option value="ambiguous">{t`保留歧义`}</option>
                      )}
                      {characters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.displayName}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
              />
            )}
          </FieldGroup>
          {failed && (
            <div role="alert" className="flex flex-col gap-2 text-sm">
              <p className="text-destructive">
                {confirmed ? (
                  <Trans>修改已保存，结果读取失败。</Trans>
                ) : (
                  <Trans>修改尚未确认保存，草稿已保留。</Trans>
                )}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => retry && void persist(retry, onSaved)}
              >
                {confirmed ? (
                  <Trans>重新读取结果</Trans>
                ) : (
                  <Trans comment="重试保存当前片段归属">重试保存</Trans>
                )}
              </Button>
              {!confirmed && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void persist(async () => {
                      await onSaved();
                      setDraft(null);
                    })
                  }
                >
                  <Trans>重新读取并放弃草稿</Trans>
                </Button>
              )}
            </div>
          )}
          <details className="text-muted-foreground text-xs">
            <summary className="cursor-pointer">
              <Trans comment="展开所选片段的分析依据与边界工具">
                分析依据与边界
              </Trans>
            </summary>
            <p className="py-2 leading-6">{segment.reason}</p>
            {segment.evidence.map((e) => (
              <Button
                key={`${e.range.start}:${e.range.end}:${e.reason}`}
                variant="ghost"
                size="sm"
                multiline
                className="justify-start text-left"
                onClick={() => onLocate(e.range)}
              >
                {e.reason}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || snapshot.stale}
              onClick={() => onEditBoundary(segment, snapshot)}
            >
              <Trans>调整片段边界</Trans>
            </Button>
          </details>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          {snapshot?.versionId
            ? t`选择正文查看角色与声音，也可先设置本章声音。`
            : t`分析本章后可直接修改角色；现在可以先设置旁白声音。`}
        </p>
      )}
    </div>
  );
}
