import type {
  ToolCallMessagePartComponent,
  ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { ToolFallback } from "@/components/assistant-ui/elements/tool-fallback.aui";
import {
  DelegatedToolCard,
  delegatedToolNames,
} from "@/components/assistant-ui/tools/delegated-tool-card";

/**
 * Failed tool calls never show their response body: provider errors may echo
 * request payloads. The trigger still surfaces the failure state.
 */
export function stripFailedToolBody<T extends ToolCallMessagePartProps>(
  part: T,
): T {
  return part.isError ? { ...part, result: undefined } : part;
}

/**
 * `Thread`'s ToolFallback slot: delegated professional tasks render their
 * subagent card, every other tool renders the standard fallback with failed
 * response bodies stripped. Registered tool UIs (none today) would take
 * precedence over this slot upstream.
 */
export const AgentToolUI: ToolCallMessagePartComponent = (part) => {
  if (delegatedToolNames.includes(part.toolName))
    return <DelegatedToolCard {...part} />;
  return <ToolFallback {...stripFailedToolBody(part)} />;
};
