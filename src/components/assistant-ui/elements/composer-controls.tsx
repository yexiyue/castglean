// Adapted from the assistant-ui elements-composer registry item.
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function ComposerModelTrigger({
  model,
  title,
  label,
  disabled,
  triggerRef,
}: {
  model: string;
  title: string;
  label: string;
  disabled?: boolean;
  triggerRef: Ref<HTMLButtonElement>;
}) {
  return (
    <DropdownMenuTrigger
      ref={triggerRef}
      data-slot="composer-model-trigger"
      disabled={disabled}
      aria-label={label}
      title={title}
      className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring flex h-8 min-w-0 items-center gap-1 rounded-full px-2 text-xs outline-none focus-visible:ring-2 data-popup-open:bg-muted disabled:opacity-50"
    >
      <span className="max-w-36 truncate">{model}</span>
      <ChevronDownIcon aria-hidden className="size-3 shrink-0 opacity-60" />
    </DropdownMenuTrigger>
  );
}

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
          "hover:bg-muted focus-visible:ring-ring grid size-8 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 data-popup-open:bg-muted",
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
