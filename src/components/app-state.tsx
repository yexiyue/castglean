import type { LucideIcon } from "lucide-react";
import {
  AlertCircleIcon,
  InboxIcon,
  LoaderCircleIcon,
  SearchIcon,
  UnplugIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

type StateKind = "empty" | "search" | "error" | "unavailable" | "loading";
const icons: Record<StateKind, LucideIcon> = {
  empty: InboxIcon,
  search: SearchIcon,
  error: AlertCircleIcon,
  unavailable: UnplugIcon,
  loading: LoaderCircleIcon,
};

export function AppState({
  kind = "empty",
  title,
  description,
  actions,
  icon,
  compact = false,
  align = "center",
  className,
}: {
  kind?: StateKind;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
  compact?: boolean;
  /** start 用于页面主区空态（跟随内容列左对齐），center 用于面板与局部区块。 */
  align?: "center" | "start";
  className?: string;
}) {
  const Icon = icon ?? icons[kind];
  return (
    <Empty
      data-app-state={kind}
      role={kind === "error" ? "alert" : "status"}
      aria-busy={kind === "loading" || undefined}
      className={cn(
        compact ? "p-4" : "min-h-64 py-10",
        align === "start" &&
          "items-start text-left [&_[data-slot=empty-content]]:items-start [&_[data-slot=empty-header]]:items-start",
        className,
      )}
    >
      <EmptyHeader>
        {!compact && (
          <EmptyMedia variant="icon">
            <Icon
              aria-hidden="true"
              className={cn(
                "size-5",
                kind === "error" && "text-destructive",
                kind === "loading" && "motion-safe:animate-spin",
              )}
            />
          </EmptyMedia>
        )}
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {actions && (
        <EmptyContent>
          <div className="flex max-w-full min-w-0 flex-wrap items-center justify-start gap-2 [&_[data-slot=button]]:h-auto [&_[data-slot=button]]:min-h-8 [&_[data-slot=button]]:max-w-full [&_[data-slot=button]]:whitespace-normal">
            {actions}
          </div>
        </EmptyContent>
      )}
    </Empty>
  );
}
