// biome-ignore-all lint/suspicious/noArrayIndexKey: Subagent message part ordinals are stable within one delegated run.

import type {
  ThreadAssistantMessagePart,
  ThreadMessage,
  ToolCallMessagePart,
} from "@assistant-ui/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
  CheckIcon,
  ChevronRightIcon,
  LoaderIcon,
  XCircleIcon,
} from "lucide-react";
import {
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/assistant-ui/elements/reasoning";
import { parseToolResult } from "@/components/assistant-ui/tools/tool-result";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";

const toolLabels = {
  directory: msg`查看章节目录`,
  analyze_chapter: msg`分析章节`,
  check_splitting: msg`检查分章`,
  cast_voices: msg`生成选角建议`,
  read_analysis: msg`查看已保存的归属`,
  search_headings: msg`查找章节标题`,
  read_context: msg`读取原文上下文`,
  compare_rules: msg`检查分章规则`,
  finish_splitting: msg`提交候选方案`,
};

/**
 * Renders the nested conversation a delegated run produced below the tool
 * call that spawned it (`ToolCallMessagePart.messages`). These messages live
 * outside runtime part context, so every part renders with standalone
 * components only.
 */
export function SubagentMessages({
  messages,
  className,
}: {
  messages: readonly ThreadMessage[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 text-xs", className)}>
      {messages.map((message, index) => (
        <SubagentMessageRow key={message.id ?? index} message={message} />
      ))}
    </div>
  );
}

function SubagentMessageRow({ message }: { message: ThreadMessage }) {
  if (message.role === "user") {
    return (
      <p className="ms-auto w-fit max-w-full rounded-surface bg-muted px-2.5 py-1.5 wrap-anywhere text-foreground">
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
          streaming={streaming && index === message.content.length - 1}
        />
      ))}
    </div>
  );
}

function SubagentPart({
  part,
  streaming,
}: {
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
  if (part.type === "tool-call") return <SubagentToolCall part={part} />;
  return null;
}

function SubagentToolCall({ part }: { part: ToolCallMessagePart }) {
  const { t } = useLingui();
  const label =
    part.toolName in toolLabels
      ? t(toolLabels[part.toolName as keyof typeof toolLabels])
      : part.toolName;
  const parsed = parseToolResult(part.result);
  const done = part.result !== undefined;
  const failed = part.isError === true;
  return (
    <details className="group/tool text-muted-foreground">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 py-0.5 transition-colors group-open/tool:text-foreground">
        <ChevronRightIcon className="size-3 transition-transform group-open/tool:rotate-90" />
        {failed ? (
          <XCircleIcon className="size-3 text-destructive" />
        ) : done ? (
          <CheckIcon className="size-3" />
        ) : (
          <LoaderIcon className="size-3 animate-spin" />
        )}
        <span className="wrap-anywhere">{label}</span>
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
