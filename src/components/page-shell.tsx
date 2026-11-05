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
          className="border-border mx-auto flex min-h-14 w-full max-w-6xl flex-wrap items-center justify-between gap-3 border-b px-6 py-3"
        >
          <h1 className="text-base font-semibold">{title}</h1>
          <p className="sr-only">{description}</p>
          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
        {children}
      </main>
    </div>
  );
}
