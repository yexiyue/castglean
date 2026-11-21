import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
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
  onVoice,
  onCast,
  onAnalyze,
}: {
  audio: ChapterAudio;
  onLocate: (range: Range) => void;
  onRepairAttribution: (range: Range) => void;
  onVoice: (target: BindingTarget) => void;
  onCast: () => void;
  onAnalyze: () => void;
}) {
  const { t } = useLingui();
  const blockers = audio.blockers ?? [];
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
    <div className="min-h-0 flex-1 overflow-y-auto">
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
          <Trans>当前没有待处理的检查项</Trans>
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
                return (
                  <li
                    key={`${kind}:${characterId ?? ""}:${blocker.segmentId ?? ""}`}
                    className="flex min-h-11 items-start justify-between gap-2 py-2"
                  >
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
                        onClick={() =>
                          onVoice(
                            characterId
                              ? { kind: "character", character_id: characterId }
                              : { kind: "narrator" },
                          )
                        }
                      >
                        <Trans>选择音色</Trans>
                      </Button>
                    )}
                    {range && repairAttribution && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onRepairAttribution(range)}
                      >
                        <Trans>定位并修正</Trans>
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
                      >
                        <Trans>模型中心</Trans>
                      </Link>
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
