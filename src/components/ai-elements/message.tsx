// Adapted from vercel/ai-elements Message/MessageContent (Apache-2.0).
// Only the display primitives are retained; styling follows CastGlean's existing tokens.
import type { HTMLAttributes } from "react";
import type { UIMessage } from "ai";
import { cn } from "@/lib/utils";

export function Message({
  from,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { from: UIMessage["role"] }) {
  return (
    <div
      data-role={from}
      className={cn(
        "group flex w-full flex-col gap-2 border-b py-4",
        from === "user" ? "is-user" : "is-assistant",
        className,
      )}
      {...props}
    />
  );
}
export function MessageContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "min-w-0 space-y-2 text-sm leading-6 wrap-break-word whitespace-pre-wrap",
        className,
      )}
      {...props}
    />
  );
}
