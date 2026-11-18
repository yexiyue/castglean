import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useLingui } from "@lingui/react/macro";
import { createContext, useContext, useEffect, useState } from "react";
import {
  ToolFallbackContent,
  ToolFallbackError,
  ToolFallbackRoot,
  ToolFallbackTrigger,
} from "@/components/assistant-ui/elements/tool-fallback.aui";
import { AgentResult } from "@/components/assistant-ui/tools/agent-result";
import { SubagentMessages } from "@/components/assistant-ui/tools/subagent-messages";
import { toolPresentation } from "@/components/assistant-ui/tools/tool-presentation";
import { parseToolResult } from "@/components/assistant-ui/tools/tool-result";
import type { ResultReference } from "@/lib/bindings";

/** The three professional tasks the unified assistant delegates to the host. */
export const delegatedToolNames: readonly string[] = [
  "analyze_chapter",
  "check_splitting",
  "cast_voices",
];

export type DelegatedToolContextValue = {
  projectId: string;
  /** Bump to revalidate mutable adoption state after workspace returns. */
  version?: string;
  onReview?: (reference: ResultReference) => void;
};

export const DelegatedToolContext =
  createContext<DelegatedToolContextValue | null>(null);

export const DelegatedToolProvider = DelegatedToolContext.Provider;

/**
 * Card for the three host-delegated professional tasks. The collapsed row is
 * the standard tool trigger (status icon, elapsed time); expanding reveals the
 * subagent's nested conversation and the typed result reference with its
 * live adoption state. Thread component slots take no props, so project
 * identity arrives through `DelegatedToolProvider` above `<Thread />`.
 */
export const DelegatedToolCard: ToolCallMessagePartComponent = ({
  toolName,
  status,
  isError,
  result,
  messages,
  argsText,
}) => {
  const { t } = useLingui();
  const context = useContext(DelegatedToolContext);
  const parsed = isError ? null : parseToolResult(result);
  const reference = parsed?.reference;
  const splitReference =
    reference?.kind === "chapter_split_proposal" ? reference : undefined;
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
              shownProposalId={
                splitReference && context ? splitReference.id : undefined
              }
            />
          ) : null}
          {reference && !splitReference && context ? (
            <AgentResult
              projectId={context.projectId}
              version={context.version}
              reference={reference}
              onReview={context.onReview}
            />
          ) : null}
        </ToolFallbackContent>
      </ToolFallbackRoot>
      {splitReference && context ? (
        <AgentResult
          projectId={context.projectId}
          version={context.version}
          reference={splitReference}
          onReview={context.onReview}
        />
      ) : null}
    </>
  );
};
