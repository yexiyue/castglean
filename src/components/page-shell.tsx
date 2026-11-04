import type { ReactNode } from "react";
import { LibrarySidebar } from "@/components/library-sidebar";

export function PageShell({
  active,
  title,
  description,
  actions,
  children,
}: {
  active: "projects" | "voices" | "models";
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
          className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-8 pt-8"
        >
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
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
