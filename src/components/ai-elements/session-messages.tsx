// biome-ignore-all lint/suspicious/noArrayIndexKey: Host part ordinals are stable and append-only within each message.
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { UIMessage } from "ai";
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleDashedIcon,
} from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import type { ResultReference } from "@/lib/bindings";

const toolLabels = {
  directory: msg`查看章节目录`,
  analyze_chapter: msg`受理章节分析`,
  check_splitting: msg`检查分章`,
  cast_voices: msg`受理选角建议`,
  read_analysis: msg`查看已保存的归属`,
  search_headings: msg`查找章节标题`,
  read_context: msg`读取原文上下文`,
  compare_rules: msg`检查分章规则`,
  finish_splitting: msg`提交候选方案`,
};

function MessageText({
  text,
  user,
  streaming,
}: {
  text: string;
  user: boolean;
  streaming: boolean;
}) {
  return user ? (
    <Bubble align="end" variant="muted">
      <BubbleContent className="wrap-anywhere">{text}</BubbleContent>
    </Bubble>
  ) : (
    <Markdown
      className="min-w-0 wrap-anywhere"
      controls={false}
      isAnimating={streaming}
      skipHtml
    >
      {text}
    </Markdown>
  );
}

type ConversationScope = { label: string; chapterId: string | null };
function MessageScope({
  scope,
  onSelect,
}: {
  scope?: ConversationScope;
  onSelect?: (id: string) => void;
}) {
  if (!scope) return null;
  const chapterId = scope.chapterId;
  const label = (
    <>
      <Trans>上下文</Trans> · {scope.label}
    </>
  );
  return chapterId && onSelect ? (
    <button
      type="button"
      className="block max-w-full truncate text-left text-xs text-muted-foreground hover:text-foreground"
      onClick={() => onSelect(chapterId)}
    >
      {label}
    </button>
  ) : (
    <p className="text-xs text-muted-foreground">{label}</p>
  );
}

function MessageRow({
  message,
  streamingMessageId,
  scopes,
  onScopeSelect,
  references,
  onReview,
  interrupted,
}: {
  message: UIMessage;
  streamingMessageId?: string;
  scopes?: Map<string, ConversationScope>;
  onScopeSelect?: (chapterId: string) => void;
  references?: Map<string, ResultReference>;
  onReview?: (reference: ResultReference) => void;
  interrupted: boolean;
}) {
  const { t, i18n } = useLingui();
  const user = message.role === "user";
  return (
    <MessageScrollerItem messageId={message.id}>
      <Message align={user ? "end" : "start"}>
        <span className="sr-only">{user ? t`你` : t`AI 助手`}</span>
        <MessageContent>
          {interrupted ? (
            <p className="text-xs text-warning">
              <Trans>此回复已中断，内容尚未完成。</Trans>
            </p>
          ) : null}
          {!user ? (
            <MessageScope
              scope={scopes?.get(message.id)}
              onSelect={onScopeSelect}
            />
          ) : null}
          {message.parts.map((part, index) => {
            if (part.type === "text")
              return (
                <MessageText
                  key={`${message.id}-text-${index}`}
                  text={part.text}
                  user={user}
                  streaming={message.id === streamingMessageId}
                />
              );
            if (part.type === "data-result") {
              const data = part.data;
              if (
                !data ||
                typeof data !== "object" ||
                !("kind" in data) ||
                !("id" in data) ||
                !("summary" in data) ||
                typeof data.kind !== "string" ||
                typeof data.id !== "string" ||
                typeof data.summary !== "string"
              )
                return null;
              const reference = {
                kind: data.kind,
                id: data.id,
                summary: data.summary,
              };
              return onReview &&
                [
                  "chapter_analysis",
                  "chapter_split_proposal",
                  "casting_suggestion",
                ].includes(reference.kind) ? (
                <Button
                  key={`result-${reference.id}`}
                  size="sm"
                  variant="outline"
                  onClick={() => onReview(reference)}
                >
                  <ChevronRightIcon />
                  {reference.kind === "chapter_analysis" ? (
                    <Trans>查看分析结果</Trans>
                  ) : reference.kind === "casting_suggestion" ? (
                    <Trans>审阅选角建议</Trans>
                  ) : (
                    <Trans>查看分章方案</Trans>
                  )}
                </Button>
              ) : (
                <p
                  key={`result-${reference.id}`}
                  className="text-xs text-muted-foreground"
                >
                  {reference.summary}
                </p>
              );
            }
            if (part.type !== "dynamic-tool") return null;
            const reference = references?.get(part.toolCallId);
            const known = toolLabels[part.toolName as keyof typeof toolLabels];
            const complete = part.state === "output-available";
            const failed = part.state === "output-error";
            const line = (
              <TraceLine
                status={failed ? "error" : complete ? undefined : "running"}
              >
                <TraceIcon>
                  {complete ? <CheckIcon /> : <CircleDashedIcon />}
                </TraceIcon>
                <TraceTitle>
                  {known ? i18n._(known) : t`执行辅助操作`}
                </TraceTitle>
                <TraceDescription>
                  {complete ? t`已完成` : failed ? t`未完成` : t`执行中`}
                </TraceDescription>
              </TraceLine>
            );
            return (
              <Trace key={part.toolCallId}>
                {failed || (complete && reference) ? (
                  <TraceCollapsible>
                    <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
                    <TraceCollapsibleContent keepMounted>
                      {failed ? (
                        <p>
                          <Trans>工具未完成，已有结果仍保留。</Trans>
                        </p>
                      ) : null}
                      {complete && reference ? (
                        reference.kind === "chapter_split_proposal" &&
                        onReview ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-auto max-w-full justify-start text-left whitespace-normal"
                            onClick={() => onReview(reference)}
                          >
                            <ChevronRightIcon />
                            <span>
                              <Trans>查看方案</Trans>
                              <span className="block text-xs text-muted-foreground">
                                {reference.summary}
                              </span>
                            </span>
                          </Button>
                        ) : (
                          <p>{reference.summary}</p>
                        )
                      ) : null}
                    </TraceCollapsibleContent>
                  </TraceCollapsible>
                ) : (
                  line
                )}
              </Trace>
            );
          })}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}

/** Business actions and result links only; provider bodies never become presentation. */
export function SessionMessages({
  messages,
  streamingMessageId,
  label,
  references,
  interruptedMessages,
  onReview,
  hasOlder,
  olderLoading,
  onLoadOlder,
  scopes,
  onScopeSelect,
}: {
  messages: UIMessage[];
  streamingMessageId?: string;
  label: string;
  references?: Map<string, ResultReference>;
  interruptedMessages?: Set<string>;
  onReview?: (reference: ResultReference) => void;
  hasOlder?: boolean;
  olderLoading?: boolean;
  onLoadOlder?: () => Promise<boolean>;
  scopes?: Map<string, ConversationScope>;
  onScopeSelect?: (chapterId: string) => void;
}) {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport
          role="log"
          aria-label={label}
          tabIndex={0}
          className="px-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          <MessageScrollerContent>
            {hasOlder ? (
              <MessageScrollerItem messageId="load-older">
                <Button
                  className="my-2 w-full"
                  variant="ghost"
                  size="sm"
                  disabled={olderLoading}
                  onClick={() => void onLoadOlder?.()}
                >
                  {olderLoading ? (
                    <Trans>正在读取…</Trans>
                  ) : (
                    <Trans>更早的消息</Trans>
                  )}
                </Button>
              </MessageScrollerItem>
            ) : null}
            {messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                streamingMessageId={streamingMessageId}
                scopes={scopes}
                onScopeSelect={onScopeSelect}
                references={references}
                onReview={onReview}
                interrupted={interruptedMessages?.has(message.id) ?? false}
              />
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton direction="end">
          <ArrowDownIcon />
          <Trans>回到最新</Trans>
        </MessageScrollerButton>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
