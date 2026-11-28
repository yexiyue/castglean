import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useContext, useEffect, useState } from "react";
import { AssistantActivity } from "@/components/assistant-ui/elements/reasoning";
import { DelegatedToolContext } from "@/components/assistant-ui/tools/delegated-tool-context";
import { AnalysisResultSurface } from "@/components/assistant-ui/tools/result-surfaces/analysis-result";
import {
  commands,
  type Invocation,
  type Progress_Serialize,
  type ResultReference,
} from "@/lib/bindings";

export function ChapterAnalysisTask({
  task,
  runId,
  chapterTitle,
  sequence,
  runStatus,
  reference,
  hasReply = false,
  children,
}: {
  task?: Invocation;
  runId?: string;
  chapterTitle?: string;
  sequence?: number;
  runStatus?: string;
  reference?: ResultReference;
  hasReply?: boolean;
  children?: ReactNode;
}) {
  const { t } = useLingui();
  const context = useContext(DelegatedToolContext);
  const subagentRunId = task?.id;
  const status = task?.status ?? runStatus;
  const active = status === "running" || status === "cancelling";
  const showProgress =
    active ||
    status === "failed" ||
    status === "interrupted" ||
    status === "cancelled";
  const [progress, setProgress] = useState<Progress_Serialize | null>(null);

  // Committed checkpoints advance the session cursor. Keep the last known
  // counts visible while reading again, but discard replies after unmount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: The session cursor invalidates the host projection.
  useEffect(() => {
    if (!runId || !subagentRunId || !showProgress) return;
    let live = true;
    void commands.chapterAnalysisProgress(runId, subagentRunId).then(
      (value) => {
        if (live) setProgress(value);
      },
      () => {
        if (live) setProgress(null);
      },
    );
    return () => {
      live = false;
    };
  }, [runId, subagentRunId, sequence, showProgress]);

  let label = t`等待开始`;
  if (status === "cancelled") {
    label = t`分析已取消`;
  } else if (status === "interrupted" || status === "failed") {
    label = status === "interrupted" ? t`分析已中断` : t`分析失败`;
  } else if (status === "succeeded") {
    label = t`分析已完成`;
  } else if (status === "suspended" || status === "waiting_for_input") {
    label = t`等待用户回答`;
  } else if (active) {
    if (status === "cancelling" || runStatus === "cancelling") {
      label = t`正在停止`;
    } else if (
      progress &&
      progress.total > 0 &&
      progress.completed === progress.total
    ) {
      label = t`正在保存分析结果…`;
    } else if (progress?.agent) {
      label = progress.agent.stage === "review" ? t`正在预审` : t`正在标注`;
    } else {
      label = t`正在准备分析…`;
    }
  }

  const title = chapterTitle ? t`章节分析 · ${chapterTitle}` : t`章节分析`;
  return (
    <section
      data-analysis-run={runId}
      data-analysis-subagent={subagentRunId}
      aria-label={title}
      className="flex min-w-0 flex-col gap-2"
    >
      {!reference && (
        <div className="flex flex-wrap items-center gap-x-2">
          {active ? (
            <AssistantActivity active label={label} />
          ) : (
            <span role="status" className="text-xs text-muted-foreground">
              {label}
            </span>
          )}
          {showProgress && progress && progress.total > 0 ? (
            <span className="text-xs text-muted-foreground">
              <Trans>
                已完成 {progress.completed} / {progress.total} 个原文窗口
              </Trans>
            </span>
          ) : null}
        </div>
      )}
      {children}
      {reference && context ? (
        <AnalysisResultSurface
          reference={reference}
          context={context}
          showCompletionMessage={!hasReply}
        />
      ) : null}
    </section>
  );
}
