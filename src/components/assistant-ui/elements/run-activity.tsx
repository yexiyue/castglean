// Adapted from assistant-ui registry: elements-run-activity.
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  CollapsibleContent,
  CollapsibleRoot as Collapsible,
  CollapsibleTrigger,
} from "./collapsible-root";

export function RunActivity({
  active,
  summary,
  children,
}: {
  active: boolean;
  summary: ReactNode;
  children: ReactNode;
}) {
  return (
    <div data-slot="run-activity" data-active={active} className="min-w-0">
      <Collapsible>
        <CollapsibleTrigger
          data-slot="reasoning-trigger"
          className="group/trigger text-muted-foreground hover:text-foreground flex min-h-7 max-w-full items-center gap-2 rounded-md text-start text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {summary}
          <ChevronRightIcon
            aria-hidden="true"
            className="size-3 shrink-0 transition-transform duration-200 group-aria-expanded/trigger:rotate-90 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
        <CollapsibleContent
          data-slot="reasoning-content"
          className="max-h-64 overflow-y-auto ps-3.5 pb-2 text-muted-foreground"
        >
          {children}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
