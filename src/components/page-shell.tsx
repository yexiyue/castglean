import type { ReactNode } from "react";
import { LibrarySidebar } from "@/components/library-sidebar";

export function PageShell({
  active,
  title,
  description,
  actions,
  children,
}: {
  active: "projects" | "voices" | "models" | "start";
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <LibrarySidebar active={active} />
      <main
        className="min-h-0 min-w-0 flex-1 overflow-y-auto"
        aria-label={title}
      >
        <div
          data-slot="page-heading"
          className="border-border bg-background sticky top-0 z-10 mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b px-6 pt-5 pb-4"
        >
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            <p className="text-foreground/70 mt-0.5 text-sm">{description}</p>
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2 pb-0.5">
              {actions}
            </div>
          )}
        </div>
        {children}
      </main>
    </div>
  );
}
