// Adapted from Vercel AI Elements, Apache-2.0.
// Source: https://elements.ai-sdk.dev/api/registry/message.json (2026-11-07).
// Retained Message/MessageContent/MessageResponse; Base UI/theme adaptation,
// CJK/code plugins only. Branch switching is owned by the host's run history.

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full min-w-0 flex-col gap-2 py-4",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className,
    )}
    data-role={from}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit max-w-full min-w-0 flex-col gap-2 overflow-hidden text-sm leading-6",
      "group-[.is-user]:bg-muted group-[.is-user]:text-foreground group-[.is-user]:rounded-surface group-[.is-user]:ml-auto group-[.is-user]:px-3 group-[.is-user]:py-2",
      "group-[.is-assistant]:text-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code };
// Streamdown keeps its link safety, tables and streaming code renderer; prose
// elements use Typeset rather than Streamdown's fixed utility scales.
const proseComponents = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  ul: "ul",
  ol: "ol",
  li: "li",
  blockquote: "blockquote",
  hr: "hr",
} as const;

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn("typeset typeset-chat size-full", className)}
      plugins={streamdownPlugins}
      components={proseComponents}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating,
);

MessageResponse.displayName = "MessageResponse";
