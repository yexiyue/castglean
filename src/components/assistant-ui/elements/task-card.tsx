"use client";

import {
  Ban,
  CheckIcon,
  ChevronRightIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react";
import { Children, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type TaskCardState =
  | "working"
  | "waiting"
  | "done"
  | "failed"
  | "cancelled";

const isRenderable = (node: ReactNode) =>
  node !== undefined && node !== null && node !== false && node !== true;

export function TaskStateIcon({
  state,
  className,
}: {
  state: TaskCardState;
  className?: string;
}) {
  if (state === "done") {
    return (
      <CheckIcon
        aria-hidden
        className={cn("size-3.5 shrink-0 text-emerald-500", className)}
      />
    );
  }
  if (state === "failed") {
    return (
      <XIcon
        aria-hidden
        className={cn("text-destructive size-3.5 shrink-0", className)}
      />
    );
  }
  if (state === "cancelled") {
    return (
      <Ban
        aria-hidden
        className={cn("text-muted-foreground size-3.5 shrink-0", className)}
      />
    );
  }
  if (state === "working") {
    return (
      <Loader2Icon
        aria-hidden
        className={cn(
          "text-muted-foreground size-3.5 shrink-0 animate-spin motion-reduce:animate-none",
          className,
        )}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "border-foreground/35 m-1 size-1.5 shrink-0 rounded-full border",
        className,
      )}
    />
  );
}

export function TaskCard({
  label,
  meta,
  state,
  elapsed,
  actions,
  result,
  open,
  onOpenChange,
  children,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "label" | "state" | "result" | "open" | "onOpenChange"
> & {
  label: string;
  meta?: string | undefined;
  state: TaskCardState;
  elapsed?: string | undefined;
  actions?: ReactNode | undefined;
  result?: ReactNode | undefined;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  children?: ReactNode | undefined;
}) {
  const hasTranscript = Children.toArray(children).length > 0;

  return (
    <Card
      size="sm"
      data-slot="task-card"
      data-state={state}
      className={cn("w-full max-w-sm gap-0 py-0", className)}
      {...props}
    >
      <Collapsible
        className="contents"
        open={open}
        onOpenChange={onOpenChange}
      >
        <CollapsibleTrigger
          render={<Button variant="ghost" />}
          disabled={!hasTranscript || (open !== undefined && !onOpenChange)}
          className="group/task-card h-auto justify-start gap-2 rounded-none px-4 py-3 text-start disabled:opacity-100"
        >
          <TaskStateIcon state={state} />
          <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
          {meta !== undefined && (
            <span
              className={cn("text-muted-foreground max-w-24 shrink-0 truncate")}
            >
              {meta}
            </span>
          )}
          {elapsed !== undefined && (
            <span
              className={"text-muted-foreground shrink-0 text-xs tabular-nums"}
            >
              {elapsed}
            </span>
          )}
          {hasTranscript && (
            <ChevronRightIcon
              aria-hidden
              className="size-3 shrink-0 text-muted-foreground transition-transform duration-200 group-aria-expanded/task-card:rotate-90 motion-reduce:transition-none"
            />
          )}
        </CollapsibleTrigger>
        {isRenderable(actions) && (
          <div
            data-slot="task-card-actions"
            className="border-border/60 border-t px-4 py-3"
          >
            {actions}
          </div>
        )}
        {hasTranscript && (
          <CollapsibleContent
            data-slot="task-card-transcript"
            className="border-border/60 flex flex-col gap-2 border-t px-4 py-3"
          >
            {children}
          </CollapsibleContent>
        )}
      </Collapsible>
      {isRenderable(result) && (
        <div
          data-slot="task-card-result"
          className="border-border/60 text-foreground/70 border-t px-4 py-3 text-xs leading-relaxed"
        >
          {result}
        </div>
      )}
    </Card>
  );
}
