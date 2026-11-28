// Adapted from assistant-ui registry: quote (presentational QuoteBlock).
import { QuoteIcon } from "lucide-react";
import type { ReactNode } from "react";

export function QuoteBlock({
  title,
  text,
  actions,
}: {
  title: ReactNode;
  text: string;
  actions: ReactNode;
}) {
  return (
    <div
      data-slot="composer-reference"
      className="m-2 flex min-w-0 items-start gap-2 self-stretch border-s border-border ps-2 text-xs"
    >
      <QuoteIcon
        aria-hidden
        className="mt-0.5 size-3 shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        <p
          data-slot="quote-block-text"
          className="truncate text-muted-foreground"
          title={text}
        >
          {text}
        </p>
      </div>
      {actions}
    </div>
  );
}
