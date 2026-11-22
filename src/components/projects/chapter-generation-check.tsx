import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ChapterAudio } from "@/hooks/use-chapter-audio";
import type {
  BindingTarget,
  ChapterAudioBlocker_Serialize as ChapterAudioBlocker,
} from "@/lib/bindings";

import { blockerRepair } from "@/lib/chapter-workflow";

type Range = { start: number; end: number };

export function ChapterGenerationCheck({
  audio,
  onLocate,
  onRepairAttribution,
  onLocateUnassigned,
  onFillUnassigned,
  renderVoice,
  onModels,
  onCast,
  onAnalyze,
}: {
  audio: ChapterAudio;
  onLocate: (range: Range) => void;
  onRepairAttribution: (range: Range) => void;
  onLocateUnassigned: (range: Range) => void;
  onFillUnassigned: () => void;
  renderVoice: (target: BindingTarget, range: Range | null) => ReactNode;
  onModels: () => void;
  onCast: () => void;
  onAnalyze: () => void;
}) {
  const { t } = useLingui();
  const [editing, setEditing] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const blockers = audio.blockers ?? [];
  const rowKey = ({ kind, characterId, segmentId }: ChapterAudioBlocker) =>
    `${kind}:${characterId ?? ""}:${segmentId ?? ""}`;
  const editingVisible = blockers.some(
    (blocker) => rowKey(blocker) === editing,
  );
  useEffect(() => {
    if (!editing || editingVisible || audio.preflight === "checking") return;
    setEditing(null);
    const nextAction = list.current?.querySelector<HTMLButtonElement>(
      "[data-repair-action]",
    );
    (nextAction ?? list.current)?.focus();
  }, [editing, editingVisible, audio.preflight]);
  const missing: ChapterAudioBlocker[] = [];
  const attribution: ChapterAudioBlocker[] = [];
  const other: ChapterAudioBlocker[] = [];
  for (const blocker of blockers) {
    if (blocker.kind === "missing_binding") missing.push(blocker);
    else if (blockerRepair(blocker.kind) === "attribution")
      attribution.push(blocker);
    else other.push(blocker);
  }
  const groups = [
    { title: t`缺少音色`, items: missing },
    { title: t`待确认归属`, items: attribution },
    { title: t`生成条件`, items: other },
  ];
  return (
    <div
      ref={list}
      tabIndex={-1}
      className="min-h-0 flex-1 overflow-y-auto outline-none"
    >
      <p role="status" className="sr-only">
        {audio.preflight === "blocked" && (
          <Plural
            value={blockers.length}
            one="剩余 # 项生成问题"
            other="剩余 # 项生成问题"
          />
        )}
      </p>
      {audio.preflight === "failed" && (
        <div className="flex items-center justify-between gap-2 p-4">
          <p role="status" className="text-sm text-muted-foreground">
            <Trans>无法检查生成条件</Trans>
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void audio.check().catch(() => {})}
          >
            <Trans>重新检查</Trans>
          </Button>
        </div>
      )}
      {audio.preflight === "ready" && (
        <p className="p-4 text-sm text-muted-foreground">
          <Trans>生成条件已满足。</Trans>
        </p>
      )}
      {audio.preflight === "checking" && (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          <Trans>正在检查生成条件…</Trans>
        </p>
      )}
      {groups.map(({ title, items }) =>
        items.length > 0 ? (
          <section key={title} className="px-4 pt-4 pb-2">
            <h3 className="flex items-baseline gap-2 text-sm font-semibold">
              {title}
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {items.length}
              </span>
            </h3>
            <ul className="mt-1 divide-y divide-border">
              {items.map((blocker) => {
                const { kind, range, characterId, line } = blocker;
                const name = blocker.characterName ?? characterId ?? t`旁白`;
                const repair = blockerRepair(kind);
                const detail =
                  repair === "analysis"
                    ? null
                    : kind === "resource_not_ready"
                      ? blocker.detail?.split("（", 1)[0]
                      : blocker.detail;
                const rowTitle: Record<ChapterAudioBlocker["kind"], string> = {
                  missing_binding: name,
                  unassigned_attribution: t`${blocker.count} 处原文未标注`,
                  unknown_attribution: t`${blocker.count} 处归属未知`,
                  ambiguous_attribution: t`${blocker.count} 处归属存在歧义`,
                  no_analysis: t`本章尚未分析`,
                  analysis_invalid: t`当前分析需要更新`,
                  voice_not_preset: t`${name} 需要改用预置音色`,
                  voice_missing: t`${name} 的音色不可用`,
                  mixed_combos: t`配音对象需要使用同一模型`,
                  resource_not_ready: t`模型资源未就绪`,
                };
                const location = t`第 ${line + 1} 行`;
                const repairAttribution = repair === "attribution";
                const editVoice = repair === "voice";
                const key = rowKey(blocker);
                const expanded = editVoice && editing === key;
                const target: BindingTarget = characterId
                  ? { kind: "character", character_id: characterId }
                  : { kind: "narrator" };
                return (
                  <li key={key} className="py-2">
                    <div className="flex min-h-8 items-start justify-between gap-2">
                      <div className="min-w-0 self-center text-sm wrap-anywhere">
                        <p>{rowTitle[kind]}</p>
                        {detail && (
                          <p className="text-xs text-muted-foreground">
                            {detail}
                          </p>
                        )}
                        {range && !repairAttribution && (
                          <Button
                            variant="link"
                            size="xs"
                            className="px-0 text-muted-foreground"
                            aria-label={t`定位「${rowTitle[kind]}」· ${location}`}
                            onClick={() => onLocate(range)}
                          >
                            {location}
                          </Button>
                        )}
                        {range && repairAttribution && (
                          <p className="text-xs text-muted-foreground">
                            {location}
                          </p>
                        )}
                      </div>
                      {editVoice && (
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={t`为「${name}」选择音色`}
                          aria-expanded={expanded}
                          data-repair-action
                          onClick={() => setEditing(expanded ? null : key)}
                        >
                          {expanded ? (
                            <Trans comment="Collapse the inline voice editor in the generation check">
                              收起音色选择
                            </Trans>
                          ) : (
                            <Trans>选择音色</Trans>
                          )}
                        </Button>
                      )}
                      {range && repairAttribution && (
                        <Button
                          variant="outline"
                          size="sm"
                          data-repair-action
                          onClick={() =>
                            kind === "unassigned_attribution"
                              ? onLocateUnassigned(range)
                              : onRepairAttribution(range)
                          }
                        >
                          {kind === "unassigned_attribution"
                            ? t`定位原文`
                            : t`定位并修正`}
                        </Button>
                      )}
                      {kind === "unassigned_attribution" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={onFillUnassigned}
                        >
                          <Trans>将未标注段设为旁白</Trans>
                        </Button>
                      )}
                      {repair === "analysis" && (
                        <Button variant="outline" size="sm" onClick={onAnalyze}>
                          <Trans>前往分析</Trans>
                        </Button>
                      )}
                      {repair === "voices" && (
                        <Button variant="outline" size="sm" onClick={onCast}>
                          <Trans>查看角色</Trans>
                        </Button>
                      )}
                      {repair === "models" && (
                        <Link
                          to="/models"
                          className={buttonVariants({
                            variant: "outline",
                            size: "sm",
                          })}
                          onClick={(event) => {
                            if (
                              event.button === 0 &&
                              !event.metaKey &&
                              !event.ctrlKey &&
                              !event.shiftKey &&
                              !event.altKey
                            )
                              onModels();
                          }}
                        >
                          <Trans>模型中心</Trans>
                        </Link>
                      )}
                    </div>
                    {expanded && (
                      <div className="mt-2 space-y-3 rounded-md border p-3">
                        {audio.mode === "multi_role" && (
                          <p className="text-xs text-muted-foreground">
                            <Trans>
                              此音色将用于该配音对象在整个工程中的后续生成。
                            </Trans>
                          </p>
                        )}
                        {renderVoice(target, range)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  );
}
