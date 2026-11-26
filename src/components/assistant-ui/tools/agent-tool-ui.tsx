import type {
  ToolCallMessagePartComponent,
  ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useContext } from "react";
import { ToolFallback } from "@/components/assistant-ui/elements/tool-fallback.aui";
import { AgentResult } from "@/components/assistant-ui/tools/agent-result";
import {
  DelegatedToolCard,
  delegatedToolNames,
} from "@/components/assistant-ui/tools/delegated-tool-card";
import { DelegatedToolContext } from "@/components/assistant-ui/tools/delegated-tool-context";
import { toolPresentation } from "@/components/assistant-ui/tools/tool-presentation";
import { parseToolResult } from "@/components/assistant-ui/tools/tool-result";

/**
 * Failed tool calls never show their response body: provider errors may echo
 * request payloads. The trigger still surfaces the failure state.
 */
export function stripFailedToolBody<T extends ToolCallMessagePartProps>(
  part: T,
): T {
  return part.isError ? { ...part, result: undefined } : part;
}

/** Renders host tool calls through Thread's tool slot. */
export const AgentToolUI: ToolCallMessagePartComponent = (part) => {
  const { t } = useLingui();
  if (delegatedToolNames.includes(part.toolName))
    return <DelegatedToolCard {...part} />;

  const { title, icon, detail } = toolPresentation(part.toolName);
  const line = part.args.line;
  const pattern = part.args.pattern;
  const summary =
    part.toolName === "read_context" && typeof line === "number"
      ? t`第 ${line + 1} 行`
      : part.toolName === "search_headings" && typeof pattern === "string"
        ? pattern
        : detail;
  return (
    <ToolFallback
      {...stripFailedToolBody(part)}
      presentation={{ title: t(title), icon, detail: summary }}
    />
  );
};

export const SplitProposalTool: ToolCallMessagePartComponent = (part) => {
  const context = useContext(DelegatedToolContext);
  const reference = part.isError
    ? undefined
    : parseToolResult(part.result)?.reference;
  if (reference?.kind === "chapter_split_proposal" && context) {
    return (
      <AgentResult
        projectId={context.projectId}
        version={context.version}
        onReview={context.onReview}
        reference={reference}
      />
    );
  }
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {part.status?.type === "running" ? (
        <Trans>正在提交分章方案…</Trans>
      ) : (
        <Trans>分章方案未能提交。</Trans>
      )}
    </p>
  );
};
