import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import {
  TaskCard,
  type TaskCardState,
} from "@/components/assistant-ui/elements/task-card";
import { Button } from "@/components/ui/button";
import type { ChapterPlayerSession } from "@/hooks/use-chapter-player";
import {
  type ChapterAudioTaskView_Serialize as AudioTask,
  commands,
} from "@/lib/bindings";
import { chapterAudioActive } from "@/lib/chapter-audio";

const cardState: Record<AudioTask["run"]["status"], TaskCardState> = {
  queued: "working",
  running: "working",
  cancelling: "working",
  succeeded: "done",
  cancelled: "cancelled",
  interrupted: "failed",
  failed: "failed",
};

export function ChapterAudioTaskCards({
  projectId,
  visible,
  player,
  onReturn,
}: {
  projectId: string;
  visible: boolean;
  player: Pick<ChapterPlayerSession, "start" | "state" | "toggle">;
  onReturn: (run: AudioTask["run"]) => void;
}) {
  const { t } = useLingui();
  const [tasks, setTasks] = useState<AudioTask[]>([]);
  const [readFailed, setReadFailed] = useState(false);
  const [openingPreview, setOpeningPreview] = useState(false);
  const [unavailableRun, setUnavailableRun] = useState<string | null>(null);
  const previewRequest = useRef(0);

  useEffect(() => {
    if (!visible) return;
    setOpeningPreview(false);
    let alive = true;
    let reading = false;
    async function refresh() {
      if (reading) return;
      reading = true;
      try {
        const recent = await commands.chapterAudioRecentTasks(projectId);
        if (alive) {
          setTasks(recent);
          setReadFailed(false);
        }
      } catch {
        if (alive) setReadFailed(true);
      } finally {
        reading = false;
      }
    }

    void refresh();
    const poll = window.setInterval(() => void refresh(), 2000);
    return () => {
      alive = false;
      window.clearInterval(poll);
      previewRequest.current++;
    };
  }, [projectId, visible]);

  async function preview({ run }: AudioTask) {
    const request = ++previewRequest.current;
    setUnavailableRun(null);
    if (player.state.active && player.state.target?.runId === run.id) {
      setOpeningPreview(false);
      player.toggle();
      return;
    }
    setOpeningPreview(true);
    try {
      const source = await commands.chapterAudioStatus(
        run.projectId,
        run.chapterId,
        run.mode,
        run.id,
        false,
      );
      if (previewRequest.current !== request) return;
      const first = source?.units.find((unit) => unit.mediaId);
      if (!first || !source || source.run.id !== run.id) {
        setUnavailableRun(run.id);
        return;
      }
      const started = await player.start(first.index, source);
      if (!started && previewRequest.current === request)
        setUnavailableRun(run.id);
    } catch {
      if (previewRequest.current === request) setUnavailableRun(run.id);
    } finally {
      if (previewRequest.current === request) setOpeningPreview(false);
    }
  }

  if (tasks.length === 0 && !readFailed) return null;
  const statusLabel: Partial<Record<AudioTask["run"]["status"], string>> = {
    succeeded: t`生成完成`,
    interrupted: t`生成已中断`,
    failed: t`生成失败`,
    cancelled: t`生成已停止`,
    cancelling: t`停止中`,
  };
  const stageLabel: Record<string, string> = {
    queued: t`等待引擎`,
    loading: t`加载模型中`,
    concatenating: t`拼接中`,
    generating: t`正在生成章节音频`,
  };
  return (
    <section
      className="flex min-w-0 flex-col gap-2 pt-3 pb-4"
      aria-label={t`最近章节生成任务`}
    >
      {readFailed && (
        <p role="status" className="text-xs text-muted-foreground">
          {t`无法刷新章节生成任务。`}
        </p>
      )}
      {tasks.map((task) => {
        const { run, previewUnitIndex } = task;
        const { completedUnits, unitCount } = run;
        const active = chapterAudioActive(run.status);
        const previewing =
          player.state.active && player.state.target?.runId === run.id;
        const playing = previewing && player.state.playing;
        const status =
          statusLabel[run.status] ??
          stageLabel[run.stage] ??
          t`正在生成章节音频`;
        return (
          <TaskCard
            key={run.id}
            data-chapter-audio-run={run.id}
            label={run.chapterTitle || t`章节音频任务`}
            meta={t({
              comment: "Task Card label for generation of the chapter's audio",
              message: "章节生成",
            })}
            state={cardState[run.status]}
            result={
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span>{status}</span>
                  {unitCount > 0 && (
                    <span className="tabular-nums">
                      {t({
                        comment:
                          "Completed and total synthesis units, counted by the desktop host",
                        message: `${completedUnits}/${unitCount} 个单元`,
                      })}
                    </span>
                  )}
                </div>
                {active && run.stage === "generating" && unitCount > 0 && (
                  <progress
                    aria-label={t`生成进度`}
                    className="h-1.5 w-full accent-foreground"
                    value={completedUnits}
                    max={unitCount}
                  />
                )}
                {unavailableRun === run.id ||
                (!active && previewUnitIndex == null) ? (
                  <p role="status">{t`此任务的音频暂不可试听。`}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {(previewing || previewUnitIndex != null) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={openingPreview}
                      onClick={() => void preview(task)}
                    >
                      {playing
                        ? t`暂停试听`
                        : t({
                            comment:
                              "Play the audio already produced by this chapter generation task",
                            message: "试听音频",
                          })}
                    </Button>
                  )}
                  {run.chapterTitle && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => onReturn(run)}
                    >
                      {t({
                        comment:
                          "Navigate to the chapter that owns this audio generation task",
                        message: "返回原章",
                      })}
                    </Button>
                  )}
                </div>
              </div>
            }
          />
        );
      })}
    </section>
  );
}
