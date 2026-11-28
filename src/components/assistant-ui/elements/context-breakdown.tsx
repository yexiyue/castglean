// Adapted from assistant-ui registry: elements-context-breakdown.
"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "@/lib/utils";
import { pct } from "../utils/range";

export interface ContextSegment {
  label: string;
  tokens: number;
  tint: string;
}

export function ContextBreakdown({
  segments,
  limit,
  label,
}: {
  segments: readonly ContextSegment[];
  limit: number;
  label: string;
}) {
  const { i18n } = useLingui();
  const fmt = (value: number) => value.toLocaleString(i18n.locale);
  const used = segments.reduce((sum, segment) => sum + segment.tokens, 0);
  const share = (tokens: number) => pct(tokens, Math.max(limit, used));

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <meter
        className="sr-only"
        aria-label={label}
        min={0}
        max={limit}
        value={Math.min(used, limit)}
        aria-valuetext={`${fmt(used)} / ${fmt(limit)}`}
      />
      <div
        data-slot="context-breakdown"
        aria-hidden
        className="flex h-2 w-full overflow-hidden rounded-full bg-muted forced-colors:border"
      >
        {segments.map((segment) => {
          const width = share(segment.tokens);
          if (width === 0) return null;
          return (
            <span
              key={segment.label}
              className={cn(
                "h-full transition-[width] duration-500 ease-out forced-color-adjust-none motion-reduce:transition-none",
                segment.tint,
              )}
              style={{ width: `${width}%` }}
            />
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        {segments.map((segment) => (
          <div key={segment.label} className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full forced-color-adjust-none",
                segment.tint,
              )}
            />
            <span className="min-w-0 flex-1 text-xs">{segment.label}</span>
            <span className={cn("shrink-0 text-xs tabular-nums")}>
              {fmt(segment.tokens)}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-muted forced-colors:border"
          />
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            <Trans comment="Unused token capacity in the AI model’s context window">
              剩余容量
            </Trans>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {fmt(Math.max(0, limit - used))}
          </span>
        </div>
      </div>
    </div>
  );
}
