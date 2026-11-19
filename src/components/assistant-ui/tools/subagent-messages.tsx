// biome-ignore-all lint/suspicious/noArrayIndexKey: Subagent message part ordinals are stable within one delegated run.

import type {
  ThreadAssistantMessagePart,
  ThreadMessage,
  ToolCallMessagePart,
} from "@assistant-ui/react";
import { useLingui } from "@lingui/react/macro";
import { ChevronRightIcon, LoaderIcon, XCircleIcon } from "lucide-react";
import {
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/assistant-ui/elements/reasoning";
import { AgentResult } from "@/components/assistant-ui/tools/agent-result";
import type { DelegatedToolContextValue } from "@/components/assistant-ui/tools/delegated-tool-card";
import { toolPresentation } from "@/components/assistant-ui/tools/tool-presentation";
import { parseToolResult } from "@/components/assistant-ui/tools/tool-result";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";

/**
 * Renders the nested conversation a delegated run produced below the tool
 * call that spawned it (`ToolCallMessagePart.messages`). These messages live
 * outside runtime part context, so every part renders with standalone
 * components only.
 */
export function SubagentMessages({
  messages,
  className,
  review,
  shownProposalId,
  suppressReferenceId,
}: {
  messages: readonly ThreadMessage[];
  className?: string;
  review?: DelegatedToolContextValue | null;
  shownProposalId?: string;
  /** Reference id already rendered outside the collapse by the owning card. */
  suppressReferenceId?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 text-xs", className)}>
      {messages.map((message, index) => (
        <SubagentMessageRow
          key={message.id ?? index}
          message={message}
          review={review}
          shownProposalId={shownProposalId}
          suppressReferenceId={suppressReferenceId}
        />
      ))}
    </div>
  );
}

type ReviewProps = {
  review?: DelegatedToolContextValue | null;
  shownProposalId?: string;
  suppressReferenceId?: string;
};

function SubagentMessageRow({
  message,
  review,
  shownProposalId,
  suppressReferenceId,
}: ReviewProps & { message: ThreadMessage }) {
  if (message.role === "user") {
    return (
      <p className="ms-auto w-fit max-w-full rounded-xl bg-muted px-2.5 py-1.5 wrap-anywhere text-foreground">
        {message.content.map((part, index) =>
          part.type === "text" ? <span key={index}>{part.text}</span> : null,
        )}
      </p>
    );
  }
  const streaming = message.status?.type === "running";
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {message.content.map((part, index) => (
        <SubagentPart
          key={index}
          part={part}
          review={review}
          shownProposalId={shownProposalId}
          suppressReferenceId={suppressReferenceId}
          streaming={streaming && index === message.content.length - 1}
        />
      ))}
    </div>
  );
}

function SubagentPart({
  part,
  streaming,
  review,
  shownProposalId,
  suppressReferenceId,
}: ReviewProps & {
  part: ThreadAssistantMessagePart;
  streaming: boolean;
}) {
  if (part.type === "text") return <Markdown>{part.text}</Markdown>;
  if (part.type === "reasoning")
    return (
      <ReasoningRoot streaming={streaming}>
        <ReasoningTrigger active={streaming} />
        <ReasoningContent>
          <ReasoningText>
            <Markdown>{part.text}</Markdown>
          </ReasoningText>
        </ReasoningContent>
      </ReasoningRoot>
    );
  if (part.type === "tool-call")
    return (
      <SubagentToolCall
        part={part}
        review={review}
        shownProposalId={shownProposalId}
        suppressReferenceId={suppressReferenceId}
      />
    );
  return null;
}

function SubagentToolCall({
  part,
  review,
  shownProposalId,
  suppressReferenceId,
}: ReviewProps & { part: ToolCallMessagePart }) {
  const { t } = useLingui();
  const { title, icon: Icon, detail } = toolPresentation(part.toolName);
  const parsed = parseToolResult(part.result);
  const done = part.result !== undefined;
  const failed = part.isError === true;
  if (part.toolName === "finish_splitting") {
    const reference = parsed?.reference;
    if (!failed && reference?.kind === "chapter_split_proposal" && review) {
      return reference.id === shownProposalId ||
        reference.id === suppressReferenceId ? null : (
        <AgentResult
          projectId={review.projectId}
          reference={reference}
          version={review.version}
          onReview={review.onReview}
        />
      );
    }
    return (
      <p className="text-muted-foreground">
        {failed ? t`分章方案未能提交。` : t(title)}
      </p>
    );
  }
  return (
    <details className="group/tool text-muted-foreground">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 py-0.5 transition-colors group-open/tool:text-foreground">
        <ChevronRightIcon className="size-3 transition-transform group-open/tool:rotate-90" />
        {failed ? (
          <XCircleIcon className="size-3 text-destructive" />
        ) : done ? (
          <Icon aria-hidden className="size-3 shrink-0" />
        ) : (
          <LoaderIcon className="size-3 animate-spin" />
        )}
        <span className="wrap-anywhere text-foreground">{t(title)}</span>
        {detail ? <span className="wrap-anywhere">{detail}</span> : null}
        {failed ? (
          <span className="text-destructive">· {t`工具未完成`}</span>
        ) : null}
      </summary>
      <div className="flex flex-col gap-1 ps-4.5 pt-1">
        {part.argsText ? (
          <pre className="font-mono text-xs leading-relaxed wrap-anywhere text-muted-foreground">
            {part.argsText}
          </pre>
        ) : null}
        {/* Failed response bodies stay hidden: provider errors may echo request payloads. */}
        {parsed && !failed ? (
          <pre className="font-mono text-xs leading-relaxed wrap-anywhere text-muted-foreground">
            {JSON.stringify(parsed.output, null, 2)}
          </pre>
        ) : null}
      </div>
    </details>
  );
}
