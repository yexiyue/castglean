"use client";

import { useLingui } from "@lingui/react/macro";
import {
  CheckIcon,
  Loader2Icon,
  MinusIcon,
  PauseIcon,
  XIcon,
} from "lucide-react";
import { type ComponentProps, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { clamp } from "../utils/range";
import { ghostButton, mono } from "./surfaces";

export type TodoStatus =
  | "pending"
  | "active"
  | "waiting"
  | "done"
  | "failed"
  | "cancelled";

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
  description?: string | undefined;
  reason?: string | undefined;
}

export function TodoList({
  items,
  revision,
  title = "Todos",
  description,
  maxVisible,
  hideHeader = false,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "items" | "revision" | "title"> & {
  items: readonly TodoItem[];
  revision?: number | undefined;
  title?: string | undefined;
  description?: string | undefined;
  maxVisible?: number | undefined;
  hideHeader?: boolean;
}) {
  const { t } = useLingui();
  const statusLabels: Record<TodoStatus, string> = {
    pending: t({
      message: "待执行",
      comment: "Accessible status for a queued task step.",
    }),
    active: t({
      message: "进行中",
      comment: "Accessible status for a currently running task step.",
    }),
    waiting: t({
      message: "等待确认",
      comment: "Task step paused for the user's approval.",
    }),
    done: t({
      message: "已完成",
      comment: "Accessible status for a completed task step.",
    }),
    failed: t({
      message: "失败",
      comment: "Accessible status for a failed task step.",
    }),
    cancelled: t({
      message: "已取消",
      comment: "Accessible status for a cancelled task step.",
    }),
  };
  const done = items.filter((item) => item.status === "done").length;
  const total = items.filter((item) => item.status !== "cancelled").length;
  const visibleCount = Math.floor(
    clamp(maxVisible ?? items.length, 0, items.length),
  );
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  function isCollapsible(item: TodoItem, index: number): boolean {
    return (
      index >= visibleCount &&
      item.status !== "active" &&
      item.status !== "waiting" &&
      item.status !== "failed"
    );
  }

  const hiddenCount = items.filter(isCollapsible).length;
  const canFold = maxVisible !== undefined && hiddenCount > 0;

  return (
    <div
      data-slot="todo-list"
      className={cn("flex w-full max-w-sm flex-col gap-3", className)}
      {...props}
    >
      {!hideHeader && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[13.5px] font-medium">{title}</span>
            {description ? (
              <p className="text-muted-foreground text-xs leading-4 break-words">
                {description}
              </p>
            ) : null}
          </div>
          <span
            className={cn(
              mono,
              "text-muted-foreground shrink-0 whitespace-nowrap tabular-nums",
            )}
          >
            {revision === undefined
              ? `${done}/${total}`
              : `${done}/${total} · rev ${revision}`}
          </span>
        </div>
      )}
      <ul id={listId} className="flex flex-col gap-1">
        {items.map((item, index) => {
          if (canFold && !expanded && isCollapsible(item, index)) return null;
          const detail =
            item.status === "failed" ? item.reason : item.description;
          return (
            <li
              key={item.id}
              data-status={item.status}
              className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex items-start gap-2.5 py-0.5 text-[13.5px] duration-300 motion-reduce:animate-none"
            >
              <span
                aria-hidden
                className="flex size-4 h-5 shrink-0 items-center justify-center"
              >
                {item.status === "done" ? (
                  <span className="border-foreground/20 bg-foreground/[0.06] flex size-3.5 items-center justify-center rounded-[5px] border">
                    <CheckIcon className="text-muted-foreground size-2.5" />
                  </span>
                ) : item.status === "failed" ? (
                  <span className="flex size-3.5 items-center justify-center rounded-[5px] border border-red-600/25 bg-red-600/[0.08] dark:border-red-400/25 dark:bg-red-400/[0.08]">
                    <XIcon className="size-2.5 text-red-600 dark:text-red-400" />
                  </span>
                ) : item.status === "cancelled" ? (
                  <span className="border-foreground/15 text-muted-foreground flex size-3.5 items-center justify-center rounded-[5px] border">
                    <MinusIcon className="size-2.5" />
                  </span>
                ) : item.status === "waiting" ? (
                  <PauseIcon className="size-3.5 text-muted-foreground" />
                ) : item.status === "active" ? (
                  <Loader2Icon className="size-3.5 animate-spin text-blue-500 motion-reduce:animate-none dark:text-blue-400" />
                ) : (
                  <span className="border-foreground/15 size-3.5 rounded-[5px] border" />
                )}
              </span>
              <span className="sr-only">{statusLabels[item.status]}</span>
              <div className="min-w-0 flex-1 leading-5 break-words">
                <span
                  className={cn(
                    item.status === "done" &&
                      "text-muted-foreground line-through decoration-[1.5px]",
                    item.status === "active" && "text-foreground/90",
                    item.status === "pending" && "text-muted-foreground",
                    item.status === "failed" &&
                      "text-red-600 dark:text-red-400",
                    item.status === "cancelled" &&
                      "text-muted-foreground line-through decoration-[1.5px]",
                  )}
                >
                  {item.text}
                </span>
                {detail ? (
                  <p className="text-muted-foreground text-xs leading-4 break-words">
                    {detail}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {canFold ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((current) => !current)}
          className={cn(
            ghostButton,
            "self-start px-2 py-1 text-xs font-medium",
          )}
        >
          {expanded
            ? t({
                message: "收起其余步骤",
                comment: "Collapse previously hidden rows in a task checklist.",
              })
            : t({
                message: `展开其余 ${hiddenCount} 步`,
                comment: "Reveal the remaining rows in a task checklist.",
              })}
        </button>
      ) : null}
    </div>
  );
}
