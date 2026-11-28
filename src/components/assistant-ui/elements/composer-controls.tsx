// Adapted from the assistant-ui elements-composer registry item.
import type { ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function ComposerContext({
  label,
  fraction,
  children,
}: {
  label: string;
  fraction: number | null;
  children: ReactNode;
}) {
  const circumference = 2 * Math.PI * 6;
  const pressure = fraction == null ? null : Math.min(fraction, 1);
  return (
    <Popover>
      <PopoverTrigger
        data-slot="composer-context"
        aria-label={label}
        openOnHover
        delay={250}
        className={cn(
          "hover:bg-muted focus-visible:ring-ring grid size-8 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2 data-popup-open:bg-muted",
          fraction != null && fraction > 0.85
            ? "text-destructive"
            : "text-primary",
        )}
      >
        <svg viewBox="0 0 16 16" className="size-4 -rotate-90" aria-hidden>
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            strokeWidth="2.5"
            className="stroke-muted-foreground/40"
            strokeDasharray={pressure == null ? "2 2" : undefined}
          />
          {pressure != null && pressure > 0 && (
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="stroke-current transition-[stroke-dashoffset] motion-reduce:transition-none"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - pressure)}
            />
          )}
        </svg>
      </PopoverTrigger>
      <PopoverContent side="top" align="end">
        {children}
      </PopoverContent>
    </Popover>
  );
}
