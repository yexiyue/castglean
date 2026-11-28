import {
  ReadonlyThreadProvider,
  type ThreadMessage,
  ThreadPrimitive,
} from "@assistant-ui/react";
import type { ReactNode } from "react";
import {
  ThreadAssistantMessage,
  ThreadUserMessage,
} from "@/components/assistant-ui/elements/thread.aui";
import { parseToolResult } from "@/components/assistant-ui/tools/tool-result";

export function SubagentMessages({
  messages,
  author,
  suppressReferenceId,
  showIndicator,
}: {
  messages: readonly ThreadMessage[];
  author: string | ((message: ThreadMessage) => string);
  suppressReferenceId?: string;
  showIndicator?: boolean;
}) {
  return (
    <ReadonlyThreadProvider messages={messages}>
      <ThreadPrimitive.Messages>
        {({ message }) => {
          if (message.role === "user") return <ThreadUserMessage />;
          if (message.role !== "assistant") return null;
          const hiddenTools = new Set<string>();
          if (suppressReferenceId) {
            for (const part of message.content) {
              if (
                part.type === "tool-call" &&
                !part.isError &&
                parseToolResult(part.result)?.reference?.id ===
                  suppressReferenceId
              ) {
                hiddenTools.add(part.toolCallId);
              }
            }
          }
          if (
            message.content.length > 0 &&
            message.content.every(
              (part) =>
                part.type === "tool-call" && hiddenTools.has(part.toolCallId),
            )
          )
            return null;
          return (
            <ThreadAssistantMessage
              author={typeof author === "string" ? author : author(message)}
              hiddenToolCallIds={hiddenTools}
              showIndicator={showIndicator}
            />
          );
        }}
      </ThreadPrimitive.Messages>
    </ReadonlyThreadProvider>
  );
}

export function SubagentCompletion({
  author,
  children,
}: {
  author: string;
  children: ReactNode;
}) {
  return (
    <div data-subagent={author} className="min-w-0 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{author}</p>
      <p className="leading-relaxed wrap-break-word">{children}</p>
    </div>
  );
}
