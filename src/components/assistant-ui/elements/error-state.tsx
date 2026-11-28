// Adapted from assistant-ui registry: elements-error-state.
"use client";

import { CircleAlertIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ErrorState({
  title,
  retryLabel,
  retrying = false,
  disabled,
  onRetry,
}: {
  title: string;
  retryLabel: string;
  retrying?: boolean;
  disabled?: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      data-slot="error-state"
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1"
    >
      <div
        role="alert"
        className="flex min-w-0 flex-1 items-start gap-2 text-xs text-destructive"
      >
        <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <p className="min-w-0 wrap-anywhere">{title}</p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        aria-busy={retrying}
        disabled={disabled || retrying}
        onClick={onRetry}
      >
        <RefreshCwIcon
          aria-hidden
          className={
            retrying ? "animate-spin motion-reduce:animate-none" : undefined
          }
        />
        {retryLabel}
      </Button>
    </div>
  );
}
