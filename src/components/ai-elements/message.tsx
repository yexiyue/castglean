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

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      plugins={streamdownPlugins}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating,
);

MessageResponse.displayName = "MessageResponse";
