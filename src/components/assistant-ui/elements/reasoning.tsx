"use client";

import { useLingui } from "@lingui/react/macro";
import { type ReactNode, useEffect, useState } from "react";
import { RunActivity } from "./run-activity";
import { ThinkingIndicator } from "./thinking-indicator";

function ActivityLine({
  label,
  active,
  duration,
}: {
  label: string;
  active: boolean;
  duration?: number;
}) {
  const { t } = useLingui();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const elapsed = active ? seconds : duration;
  const elapsedLabel = elapsed
    ? t({
        message: `${elapsed} 秒`,
        comment: "Elapsed seconds displayed on an assistant activity line.",
      })
    : undefined;
  if (active) {
    return (
      <ThinkingIndicator
        label={label}
        elapsed={elapsedLabel}
        className="min-w-0 text-xs"
      />
    );
  }
  return (
    <>
      <span className="min-w-0 wrap-break-word">{label}</span>
      {elapsedLabel && (
        <span aria-hidden className="shrink-0 tabular-nums">
          {elapsedLabel}
        </span>
      )}
    </>
  );
}

const lineClass =
  "flex min-h-7 items-center gap-2 text-start text-xs text-muted-foreground";

export function AssistantActivity({
  label,
  active,
  children,
  duration,
}: {
  label?: string;
  active: boolean;
  children?: ReactNode;
  duration?: number;
}) {
  const { t } = useLingui();
  const status =
    label ??
    (active
      ? t({
          message: "正在思考…",
          comment: "Assistant has started streaming a visible reasoning part.",
        })
      : t({
          message: "思考摘要",
          comment:
            "Disclosure label for a completed, user-visible model reasoning summary.",
        }));

  if (!children) {
    return (
      <div data-slot="assistant-activity" className={lineClass}>
        <ActivityLine label={status} active={active} />
      </div>
    );
  }
  return (
    <RunActivity
      active={active}
      summary={
        <ActivityLine label={status} active={active} duration={duration} />
      }
    >
      {children}
    </RunActivity>
  );
}
