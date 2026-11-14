import { type ReactNode, useId } from "react";
import { LibrarySidebar } from "@/components/library-sidebar";

/** One contextual bar; collection navigation replaces a repeated page title. */
export function PageShell({
  active,
  title,
  description,
  navigation,
  actions,
  children,
}: {
  /** 导入等流程页不属于任何目的地，缺省时侧栏无选中项。 */
  active?: "projects" | "voices" | "models" | "start";
  title: string;
  description: string;
  navigation?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const descriptionId = useId();
  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <LibrarySidebar active={active} />
      <main
        className="bg-card min-h-0 min-w-0 flex-1 overflow-y-auto"
        aria-label={title}
        aria-describedby={descriptionId}
      >
        <header
          data-slot="page-heading"
          className="bg-card border-border sticky top-0 z-10 flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-5 py-2"
        >
          <h1
            className={navigation ? "sr-only" : "min-w-0 text-sm font-semibold"}
          >
            {title}
          </h1>
          {navigation && <div className="min-w-0">{navigation}</div>}
          <p id={descriptionId} className="sr-only">
            {description}
          </p>
          {actions && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {actions}
            </div>
          )}
        </header>
        {children}
      </main>
    </div>
  );
}
