import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useLingui } from "@lingui/react/macro";
import { useContext, useEffect, useState } from "react";
import {
  ToolFallbackContent,
  ToolFallbackError,
  ToolFallbackRoot,
  ToolFallbackTrigger,
} from "@/components/assistant-ui/elements/tool-fallback.aui";
import { AgentResult } from "@/components/assistant-ui/tools/agent-result";
import { DelegatedToolContext } from "@/components/assistant-ui/tools/delegated-tool-context";
import { SubagentMessages } from "@/components/assistant-ui/tools/subagent-messages";
import { toolPresentation } from "@/components/assistant-ui/tools/tool-presentation";
import { parseToolResult } from "@/components/assistant-ui/tools/tool-result";

/** The three professional tasks the unified assistant delegates to the host. */
export const delegatedToolNames: readonly string[] = [
  "analyze_chapter",
  "check_splitting",
  "cast_voices",
];

/**
 * Card for the three host-delegated professional tasks, in three segments:
 * the collapsed trigger row, the audition progress anchored beside the call,
 * and the typed result surface rendered outside the collapsible so the
 * outcome and its in-place operations stay visible without expanding.
 * Thread component slots take no props, so project identity arrives through
 * `DelegatedToolProvider` above `<Thread />`.
 */
export const DelegatedToolCard: ToolCallMessagePartComponent = ({
  toolName,
  status,
  isError,
  result,
  messages,
  argsText,
}) => {
  const context = useContext(DelegatedToolContext);
  const { t } = useLingui();
  const parsed = isError ? null : parseToolResult(result);
  const reference = parsed?.reference;
  const { title, icon } = toolPresentation(toolName);
  const isRequiresAction = status?.type === "requires-action";
  const [open, setOpen] = useState(isRequiresAction);
  useEffect(() => {
    if (isRequiresAction) setOpen(true);
  }, [isRequiresAction]);
  return (
    <>
      <ToolFallbackRoot open={open} onOpenChange={setOpen}>
        <ToolFallbackTrigger
          toolName={toolName}
          presentation={{ title: t(title), icon }}
          status={status}
          isError={isError}
        />
        <ToolFallbackContent>
          <ToolFallbackError status={status} />
          {argsText ? (
            <pre className="font-mono text-xs leading-relaxed wrap-anywhere text-muted-foreground">
              {argsText}
            </pre>
          ) : null}
          {messages && messages.length > 0 ? (
            <SubagentMessages
              messages={messages}
              className="ps-1"
              review={context}
              Result={AgentResult}
              suppressReferenceId={reference?.id}
            />
          ) : null}
        </ToolFallbackContent>
      </ToolFallbackRoot>
      {reference && context ? (
        <AgentResult
          projectId={context.projectId}
          version={context.version}
          reference={reference}
          onReview={context.onReview}
        />
      ) : null}
    </>
  );
};
