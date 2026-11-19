import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { ChapterPlayerSession } from "@/hooks/use-chapter-player";
import { formatClock } from "@/lib/chapter-playback";
import { cn } from "@/lib/utils";
import { useChapterPlayback } from "./chapter-playback-provider";

/** The single control surface for the frozen chapter playback session. */
export function ChapterPlaybackBar() {
  const { player, requestReturn } = useChapterPlayback();
  const navigate = useNavigate();
  return (
    <ChapterPlaybackControls
      player={player}
      onReturn={() => {
        const target = player.state.target;
        const range = player.state.unit?.range;
        if (!target || !range) return;
        requestReturn({
          projectId: target.projectId,
          chapterId: target.chapterId,
          range,
        });
        void navigate({
          to: "/project/$id",
          params: { id: target.projectId },
          search: { section: "chapters" },
        });
      }}
    />
  );
}

export function ChapterPlaybackNotice({
  player,
}: {
  player: ChapterPlayerSession;
}) {
  const { failed, gapIndex, target } = player.state;
  const chapterTitle = target?.chapterTitle;
  if (!failed && (gapIndex == null || !chapterTitle)) return null;
  return (
    <div
      role={failed ? "alert" : "status"}
      className={cn(
        "flex shrink-0 items-center gap-2 border-t px-3 py-1 text-xs",
        failed ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <span className="flex-1">
        {failed ? (
          <Trans>音频无法播放，请重新选择片段。</Trans>
        ) : (
          <Trans>「{chapterTitle}」的后续片段尚未生成。</Trans>
        )}
      </span>
      <Button size="xs" variant="ghost" onClick={player.stop}>
        <Trans>关闭</Trans>
      </Button>
    </div>
  );
}

export function ChapterPlaybackControls({
  player,
  onReturn,
}: {
  player: ChapterPlayerSession;
  onReturn: () => void;
}) {
  const { t } = useLingui();
  const { state } = player;
  const target = state.target;
  if (!state.active || !target)
    return <ChapterPlaybackNotice player={player} />;
  return (
    <section
      aria-label={t`章节播放控制`}
      data-slot="chapter-playback-bar"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t bg-card px-3 py-2 text-sm"
    >
      <span
        className="min-w-0 flex-1 truncate"
        title={`${target.projectTitle} · ${target.chapterTitle}`}
      >
        {target.projectTitle} · {target.chapterTitle}
      </span>
      <Button size="sm" variant="outline" onClick={player.toggle}>
        {state.playing ? t`暂停` : t`继续播放`}
      </Button>
      {state.unit && (
        <span className="whitespace-nowrap text-muted-foreground">{t`片段 ${state.unit.index + 1}`}</span>
      )}
      <span className="text-muted-foreground tabular-nums">
        {formatClock(state.time)} / {formatClock(state.duration)}
      </span>
      <Slider
        className="max-w-56 min-w-24 flex-1"
        aria-label={t`播放进度`}
        value={[Math.min(state.time, state.duration)]}
        min={0}
        max={Math.max(state.duration, 0.1)}
        step={0.1}
        getAriaValueText={(_, value) =>
          `${formatClock(value)} / ${formatClock(state.duration)}`
        }
        onValueChange={(value) =>
          player.seek(typeof value === "number" ? value : value[0])
        }
      />
      <Button
        size="sm"
        variant="ghost"
        disabled={!state.unit?.range}
        onClick={onReturn}
      >
        <Trans>返回播放位置</Trans>
      </Button>
      <Button size="sm" variant="ghost" onClick={player.stop}>
        <Trans>停止播放</Trans>
      </Button>
    </section>
  );
}
