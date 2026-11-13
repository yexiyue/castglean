import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { AudioLines, CircleAlert, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ChapterAudio } from "@/hooks/use-chapter-audio";
import type { ChapterPlayerSession } from "@/hooks/use-chapter-player";
import type {
  BindingTarget,
  ChapterAudioBlocker_Serialize as ChapterAudioBlocker,
  ChapterAudioRunView_Serialize as ChapterAudioRunView,
  ChapterAudioStatusView_Serialize as ChapterAudioStatusView,
} from "@/lib/bindings";

type Range = { start: number; end: number };
type Units = ChapterAudioStatusView["units"];

const ROW = "flex items-center gap-2 border-b px-3 py-2 text-xs";

/**
 * 章节音频状态条：阻塞、真实进度、中断/失败位置与共享播放会话控制。
 * 只呈现宿主事实与播放会话状态；任务由宿主持有，播放与生成互不阻塞。
 */
export function ChapterAudioBar({
  audio,
  chapterId,
  onLocate,
  onCharacters,
  onChapter,
}: {
  audio: ChapterAudio;
  chapterId: string;
  player: ChapterPlayerSession;
  onLocate: (range: Range) => void;
  onCharacters: (target?: BindingTarget) => void;
  onChapter: (chapterId: string) => void;
}) {
  if (!audio.desktop) return null;
  const run = audio.status?.run ?? null;
  const units = audio.status?.units ?? [];
  const running = run && audio.active?.id === run.id ? audio.active : null;
  const elsewhere =
    audio.active && audio.active.chapterId !== chapterId ? audio.active : null;
  return (
    <>
      {audio.failure && <StartFailure audio={audio} />}
      {audio.blockers && (
        <BlockerList
          audio={audio}
          blockers={audio.blockers}
          onLocate={onLocate}
          onCharacters={onCharacters}
        />
      )}
      {elsewhere && <OtherChapterRun run={elsewhere} onChapter={onChapter} />}
      {running && <ActiveRun run={running} cancel={audio.cancel} />}
      {!running && run && run.status !== "succeeded" && (
        <EndedRun
          run={run}
          units={units}
          audio={audio}
          onLocate={audio.status?.arrangement.stale ? undefined : onLocate}
        />
      )}
    </>
  );
}

function StartFailure({ audio }: { audio: ChapterAudio }) {
  const { t } = useLingui();
  return (
    <div role="alert" className={`${ROW} text-destructive`}>
      <CircleAlert className="size-3.5 shrink-0" />
      <span className="flex-1">
        {audio.failure === "busy"
          ? t`引擎正被其他任务占用，请稍后再试。`
          : audio.failure === "changed"
            ? t`当前文本、声音或模型版本已变化。请生成新版本，旧音频仍保留。`
            : t`未能开始生成，请重试。`}
      </span>
      {audio.failure === "changed" && (
        <Button
          variant="outline"
          size="sm"
          disabled={audio.starting || !!audio.active}
          onClick={() => void audio.start(true)}
        >
          <Trans>生成新版本</Trans>
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={audio.dismiss}>
        <Trans>关闭</Trans>
      </Button>
    </div>
  );
}

function ActiveRun({
  run,
  cancel,
}: {
  run: ChapterAudioRunView;
  cancel: (runId: string) => void;
}) {
  const { t } = useLingui();
  const stages: Record<string, string> = {
    queued: t`等待引擎`,
    loading: t`正在加载模型`,
    generating: t`正在合成`,
    concatenating: t`正在拼接整章`,
  };
  const total = run.unitCount;
  const done = run.completedUnits;
  // 只有开始合成后才有可靠的单元计数；加载阶段不显示比例。
  const counted = run.stage === "generating" || run.stage === "concatenating";
  return (
    <div role="status" className={`${ROW} gap-3`}>
      <Loader2Icon className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
      <span className="shrink-0">{stages[run.stage] ?? run.stage}</span>
      <Progress
        className="min-w-16 flex-1"
        aria-label={t`生成进度`}
        value={counted && total > 0 ? (done / total) * 100 : null}
      />
      {counted && (
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {t`${done} / ${total} 单元`}
        </span>
      )}
      {run.status === "cancelling" ? (
        <span className="text-muted-foreground shrink-0">
          <Trans>正在取消，等待当前单元收尾</Trans>
        </span>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => cancel(run.id)}>
          <Trans>取消</Trans>
        </Button>
      )}
    </div>
  );
}

function OtherChapterRun({
  run,
  onChapter,
}: {
  run: ChapterAudioRunView;
  onChapter: (chapterId: string) => void;
}) {
  const { t } = useLingui();
  return (
    <div role="status" className={ROW}>
      <AudioLines className="text-muted-foreground size-3.5 shrink-0" />
      <span className="text-muted-foreground min-w-0 flex-1 truncate">
        {t`「${run.chapterTitle}」正在生成音频：${run.completedUnits} / ${run.unitCount} 单元`}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChapter(run.chapterId)}
      >
        <Trans>查看</Trans>
      </Button>
    </div>
  );
}

function EndedRun({
  run,
  units,
  audio,
  onLocate,
}: {
  run: ChapterAudioRunView;
  units: Units;
  audio: ChapterAudio;
  onLocate?: (range: Range) => void;
}) {
  const { t } = useLingui();
  const failedUnit =
    run.failedIndex == null ? null : (units[run.failedIndex] ?? null);
  const position = (run.failedIndex ?? 0) + 1;
  const reasons: Record<string, string> = {
    preparing_resources: t`模型资源正在准备，完成后可重新生成`,
    source_unavailable: t`原文暂不可读取，请重新打开工程后再试`,
    engine_load_failed: t`模型加载失败，可在模型中心检查资源`,
    unit_synthesis_failed: t`模型未能朗读第 ${position} 个单元，请定位检查字符和语言支持，或更换声音后生成新版本`,
    audio_format_changed: t`第 ${position} 个单元的音频格式与前面不一致`,
    audio_write_failed: t`音频写入失败，请检查磁盘空间`,
    concat_failed: t`整章拼接失败`,
    no_speakable_text: t`本章没有可朗读的内容`,
  };
  const message =
    run.status === "cancelled"
      ? t`已取消生成`
      : run.status === "interrupted"
        ? t`应用退出时生成中断，未自动继续`
        : ((run.error && reasons[run.error]) ?? t`生成未完成`);
  const kept = run.completedUnits > 0;
  return (
    <div role="status" className={ROW}>
      <CircleAlert className="text-muted-foreground size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        {message}
        {kept &&
          ` · ${t`已保留 ${run.completedUnits} / ${run.unitCount} 个单元的音频，正文片段旁可试听`}`}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={audio.starting || !!audio.active}
        onClick={() => void audio.start(false)}
      >
        <Trans>继续生成</Trans>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={audio.starting || !!audio.active}
        onClick={() => void audio.start(true)}
      >
        <Trans>生成新版本</Trans>
      </Button>
      {failedUnit && onLocate && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onLocate(failedUnit.range)}
        >
          <Trans>定位失败位置</Trans>
        </Button>
      )}
    </div>
  );
}

function BlockerList({
  audio,
  blockers,
  onLocate,
  onCharacters,
}: {
  audio: ChapterAudio;
  blockers: ChapterAudioBlocker[];
  onLocate: (range: Range) => void;
  onCharacters: (target?: BindingTarget) => void;
}) {
  const { t } = useLingui();
  return (
    <section
      aria-label={t`生成前需要处理的问题`}
      className="border-b px-3 py-2 text-xs"
    >
      <div className="flex items-center gap-2">
        <CircleAlert className="text-destructive size-3.5 shrink-0" />
        <p className="flex-1 font-medium">
          <Trans>本章还不能生成，先处理以下问题</Trans>
        </p>
        <Button variant="ghost" size="sm" onClick={audio.dismiss}>
          <Trans>关闭</Trans>
        </Button>
      </div>
      <ul className="mt-1 flex flex-col">
        {blockers.map((blocker) => {
          const range = blocker.range;
          const binding =
            blocker.kind === "missing_binding" ||
            blocker.kind === "voice_not_preset" ||
            blocker.kind === "voice_missing" ||
            blocker.kind === "mixed_combos";
          return (
            <li
              key={`${blocker.kind}:${blocker.characterId ?? ""}:${blocker.segmentId ?? ""}`}
              className="flex items-center gap-2 border-t py-1"
            >
              <BlockerText blocker={blocker} />
              {range && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onLocate(range)}
                >
                  <Trans>定位</Trans>
                </Button>
              )}
              {binding && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onCharacters(
                      blocker.characterId
                        ? {
                            kind: "character",
                            character_id: blocker.characterId,
                          }
                        : { kind: "narrator" },
                    )
                  }
                >
                  <Trans>设置声音</Trans>
                </Button>
              )}
              {blocker.kind === "resource_not_ready" && (
                <Button
                  variant="ghost"
                  size="sm"
                  render={<Link to="/models" />}
                >
                  <Trans>模型中心</Trans>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BlockerText({ blocker }: { blocker: ChapterAudioBlocker }) {
  const { t } = useLingui();
  const who = blocker.characterName ?? blocker.characterId ?? t`旁白`;
  const detail = blocker.detail ?? "";
  const text: Record<ChapterAudioBlocker["kind"], string> = {
    no_analysis: t`本章尚未分析，请先完成归属分析`,
    analysis_invalid: t`当前分析与章节范围不一致，需要重新分析`,
    unknown_attribution: t`${blocker.count} 处归属未知`,
    ambiguous_attribution: t`${blocker.count} 处归属存在歧义`,
    missing_binding: t`${who} 尚未绑定声音`,
    voice_not_preset: t`${who} 绑定的是音色库声音，本阶段仅支持同一模型的预置音色`,
    mixed_combos: t`声音绑定分布在多个模型（${detail}），本阶段仅支持单一模型`,
    voice_missing: t`${who} 的音色不在已就绪的音色目录中（${detail}）`,
    resource_not_ready: t`模型资源未就绪（${detail}）`,
  };
  return (
    <span className="text-muted-foreground min-w-0 flex-1">
      {text[blocker.kind]}
      {blocker.range && ` · ${t`第 ${blocker.line + 1} 行`}`}
    </span>
  );
}
