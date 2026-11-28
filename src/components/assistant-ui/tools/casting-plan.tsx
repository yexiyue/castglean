import type { Interrupt } from "@ag-ui/core";
import { useLingui } from "@lingui/react/macro";
import { ChevronRightIcon } from "lucide-react";
import {
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
} from "@/components/assistant-ui/elements/collapsible-root";
import {
  type TodoItem,
  TodoList,
  type TodoStatus,
} from "@/components/assistant-ui/elements/todo-list";
import { CastingApproval } from "@/components/assistant-ui/tools/casting-approval";
import type { CastingProgress } from "@/lib/bindings";

function terminalTodoStatus(status?: string): TodoStatus | undefined {
  switch (status) {
    case "failed":
    case "interrupted":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return undefined;
  }
}

export function CastingPlan({
  answerTarget,
  projectId,
  status,
  progress,
  published,
  interrupt,
  blocked,
  accept,
}: {
  answerTarget?: string;
  projectId: string;
  status?: string;
  progress?: CastingProgress;
  published: boolean;
  interrupt?: Interrupt;
  blocked: boolean;
  accept: (submit: () => Promise<void>) => Promise<void>;
}) {
  const { t } = useLingui();
  const terminal = terminalTodoStatus(status);
  const unfinished: TodoStatus =
    terminal ?? (status === "running" ? "active" : "pending");
  const prepared = published || Boolean(interrupt || progress);
  const items: TodoItem[] = [
    {
      id: "prepare",
      text: t({
        message: "整理角色和候选音色",
        comment:
          "First step of a casting job, before an optional preview approval.",
      }),
      status: prepared ? "done" : unfinished,
    },
  ];

  if (interrupt || progress) {
    items.push({
      id: "approve",
      text: t({
        message: "确认试听方案",
        comment:
          "Casting step that requires the user to approve the voice preview list.",
      }),
      status: interrupt ? "waiting" : "done",
    });
    const previewCount = progress
      ? t({
          message: `已处理 ${progress.finished}/${progress.total} 条试听`,
          comment:
            "Completed preview attempts, including failed attempts, out of approved previews.",
        })
      : undefined;
    const previewFailure =
      progress && progress.failed > 0
        ? t`${progress.failed} 条试听未能生成`
        : undefined;
    const previewDetails = [previewCount, previewFailure]
      .filter(Boolean)
      .join(" · ");
    let previewStatus: TodoStatus = "pending";
    if (progress) {
      previewStatus = unfinished;
      if (progress.finished === progress.total) {
        previewStatus =
          progress.total > 0 && progress.failed === progress.total
            ? "failed"
            : "done";
      }
    }
    items.push({
      id: "preview",
      text: t({
        message: "生成试听",
        comment:
          "Casting checklist step for synthesizing approved voice samples.",
      }),
      status: previewStatus,
      description: previewDetails,
      reason: previewDetails,
    });
  }

  let publishStatus: TodoStatus = "pending";
  if (published) {
    publishStatus = "done";
  } else if (!interrupt && progress && progress.finished === progress.total) {
    publishStatus = unfinished;
  }
  items.push({
    id: "publish",
    text: t({
      message: "保存选角建议",
      comment:
        "Last casting step, completed after the host publishes the recommendation.",
    }),
    status: publishStatus,
  });
  const completed = items.filter((item) => item.status === "done").length;
  const current = items.find(
    (item) => item.status === "waiting" || item.status === "active",
  );
  function planLabel(): string {
    if (interrupt) {
      return t({
        message: "等待确认试听方案",
        comment:
          "Collapsed casting checklist label prompting preview approval.",
      });
    }
    if (status === "cancelling") return t`正在停止`;
    if (published) {
      return t({
        message: "选角建议已保存",
        comment: "Collapsed casting checklist after publication.",
      });
    }
    if (terminal === "cancelled") {
      return t({
        message: "选角已取消",
        comment: "Collapsed casting checklist for a cancelled job.",
      });
    }
    if (terminal === "failed") {
      return t({
        message: "选角未完成",
        comment: "Collapsed casting checklist for a failed or interrupted job.",
      });
    }
    if (current?.id === "preview") return t`正在生成试听`;
    if (current?.id === "publish") return t`正在整理选角建议`;
    return current?.text ?? t`工程选角建议`;
  }

  return (
    <CollapsibleRoot
      id={answerTarget}
      data-slot="casting-plan"
      className="min-w-0"
    >
      <CollapsibleTrigger
        data-casting-approval-trigger
        data-awaiting={!!interrupt}
        className="group/casting flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-start text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-ring data-[awaiting=true]:bg-muted data-[awaiting=true]:font-semibold data-[awaiting=true]:text-foreground"
      >
        <ChevronRightIcon
          aria-hidden
          className="size-3 shrink-0 group-aria-expanded/casting:rotate-90"
        />
        <span className="min-w-0 flex-1 wrap-break-word">{planLabel()}</span>
        <span className="shrink-0 tabular-nums">
          {completed}/{items.length}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted className="space-y-3 pt-2 pb-1">
        {interrupt && (
          <CastingApproval
            key={interrupt.id}
            projectId={projectId}
            interrupt={interrupt}
            blocked={blocked}
            accept={accept}
          />
        )}
        <div className="ps-2">
          <TodoList items={items} hideHeader />
        </div>
      </CollapsibleContent>
    </CollapsibleRoot>
  );
}
