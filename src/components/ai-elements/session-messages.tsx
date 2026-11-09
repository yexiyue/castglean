// biome-ignore-all lint/a11y/noNoninteractiveTabindex: The scrollable history supports keyboard reading and focus return.
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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
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
  read_analysis: msg`查看已保存的归属`,
  search_headings: msg`查找章节标题`,
  read_context: msg`读取原文上下文`,
  test_rules: msg`检查分章规则`,
  patch_boundaries: msg`调整章节起点`,
  submit_proposal: msg`提交候选方案`,
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
    <p className="wrap-anywhere whitespace-pre-wrap">{text}</p>
  ) : (
    <MessageResponse
      className="ai-message-response min-w-0 text-sm leading-6 wrap-anywhere"
      controls={false}
      isAnimating={streaming}
      skipHtml
    >
      {text}
    </MessageResponse>
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
      className="text-muted-foreground hover:text-foreground mb-1 block max-w-full truncate text-left text-xs"
      onClick={() => onSelect(chapterId)}
    >
      {label}
    </button>
  ) : (
    <p className="text-muted-foreground mb-1 text-xs">{label}</p>
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
  const { t, i18n } = useLingui();
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [showLatest, setShowLatest] = useState(false);
  const follow = useRef(true);
  const previousHeight = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reconcile scroll after message DOM updates, never on every layout render.
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    if (previousHeight.current !== null) {
      element.scrollTop += element.scrollHeight - previousHeight.current;
      previousHeight.current = null;
    } else if (follow.current) element.scrollTop = element.scrollHeight;
  }, [messages]);
  useEffect(() => {
    if (!content.current) return;
    const observer = new ResizeObserver(() => {
      if (follow.current && scroll.current)
        scroll.current.scrollTop = scroll.current.scrollHeight;
    });
    observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroll}
        role="log"
        tabIndex={0}
        aria-label={label}
        className="focus-visible:ring-ring/50 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 outline-none focus-visible:ring-2 focus-visible:ring-inset"
        onScroll={(event) => {
          const element = event.currentTarget;
          follow.current =
            element.scrollHeight - element.clientHeight - element.scrollTop <
            64;
          setShowLatest(!follow.current);
        }}
      >
        <div ref={content}>
          {hasOlder ? (
            <Button
              className="my-2 w-full"
              variant="ghost"
              size="sm"
              disabled={olderLoading}
              onClick={() => {
                const element = scroll.current;
                if (element) previousHeight.current = element.scrollHeight;
                void onLoadOlder?.().then((loaded) => {
                  if (!loaded) previousHeight.current = null;
                });
              }}
            >
              {olderLoading ? (
                <Trans>正在读取…</Trans>
              ) : (
                <Trans>更早的消息</Trans>
              )}
            </Button>
          ) : null}
          {messages.map((message) => (
            <Message key={message.id} from={message.role}>
              <span className="sr-only">
                {message.role === "user" ? t`你` : t`AI 助手`}
              </span>
              {interruptedMessages?.has(message.id) ? (
                <p className="text-warning text-xs">
                  <Trans>此回复已中断，内容尚未完成。</Trans>
                </p>
              ) : null}
              <MessageContent>
                {message.role === "assistant" ? (
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
                        user={message.role === "user"}
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
                      ["chapter_analysis", "chapter_split_proposal"].includes(
                        reference.kind,
                      ) ? (
                      <Button
                        key={`result-${reference.id}`}
                        size="sm"
                        variant="outline"
                        onClick={() => onReview(reference)}
                      >
                        <ChevronRightIcon />
                        {reference.kind === "chapter_analysis" ? (
                          <Trans>查看分析结果</Trans>
                        ) : (
                          <Trans>查看分章方案</Trans>
                        )}
                      </Button>
                    ) : (
                      <p
                        key={`result-${reference.id}`}
                        className="text-muted-foreground text-xs"
                      >
                        {reference.summary}
                      </p>
                    );
                  }
                  if (part.type !== "dynamic-tool") return null;
                  const reference = references?.get(part.toolCallId);
                  const known =
                    toolLabels[part.toolName as keyof typeof toolLabels];
                  const complete = part.state === "output-available";
                  const failed = part.state === "output-error";
                  const line = (
                    <TraceLine
                      status={
                        failed ? "error" : complete ? undefined : "running"
                      }
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
                          <TraceCollapsibleTrigger>
                            {line}
                          </TraceCollapsibleTrigger>
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
                                    <span className="text-muted-foreground block text-xs">
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
          ))}
        </div>
      </div>
      {showLatest ? (
        <Button
          variant="outline"
          size="sm"
          className="bg-background absolute right-4 bottom-2"
          onClick={() => {
            follow.current = true;
            setShowLatest(false);
            scroll.current?.focus({ preventScroll: true });
            scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
          }}
        >
          <ArrowDownIcon />
          <Trans>回到最新</Trans>
        </Button>
      ) : null}
    </div>
  );
}
