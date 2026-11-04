import type { ReactNode } from "react";
import {
  AlertCircleIcon,
  InboxIcon,
  LoaderCircleIcon,
  SearchIcon,
  UnplugIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
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
  className,
}: {
  kind?: StateKind;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
  compact?: boolean;
  className?: string;
}) {
  const Icon = icon ?? icons[kind];
  return (
    <Empty
      data-app-state={kind}
      role={kind === "error" ? "alert" : "status"}
      aria-busy={kind === "loading" || undefined}
      className={cn(compact ? "p-4" : "min-h-64 py-10", className)}
    >
      <EmptyHeader>
        {!compact && (
          <EmptyMedia variant="icon">
            <Icon
              aria-hidden="true"
              className={cn(
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
          <div className="flex max-w-full min-w-0 flex-wrap items-center justify-center gap-2 [&_[data-slot=button]]:h-auto [&_[data-slot=button]]:min-h-8 [&_[data-slot=button]]:max-w-full [&_[data-slot=button]]:whitespace-normal">
            {actions}
          </div>
        </EmptyContent>
      )}
    </Empty>
  );
}
