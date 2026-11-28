"use client";

import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  type AssistantState,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  ThreadPrimitive,
  type ToolCallMessagePartComponent,
  useAuiState,
} from "@assistant-ui/react";
import { useLingui } from "@lingui/react/macro";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  RefreshCwIcon,
  SquareIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  type ComponentType,
  createContext,
  type FC,
  type PropsWithChildren,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MarkdownText } from "@/components/assistant-ui/elements/markdown-text";
import { AssistantActivity } from "@/components/assistant-ui/elements/reasoning";
import { ToolFallback } from "@/components/assistant-ui/elements/tool-fallback.aui";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/elements/tool-group.aui";
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

const DefaultToolGroup: FC<PropsWithChildren<{ group: ThreadGroupPart }>> = ({
  group,
  children,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <ToolGroupRoot
      variant="ghost"
      open={open || group.counts.requiresAction > 0}
      onOpenChange={setOpen}
    >
      <ToolGroupTrigger
        count={group.indices.length}
        active={group.status.type === "running"}
      />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  );
};

const shouldShowComposerResume = (s: AssistantState) =>
  !!s.thread.canResume && s.composer.type === "thread" && s.composer.isEmpty;

const reasoningDuration = (timing: ThreadGroupPart["timing"]) =>
  timing?.completedAt === undefined
    ? undefined
    : Math.round((timing.completedAt - timing.startedAt) / 1000);

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; the remaining slots override how the
 * assistant message renders tool calls and part groups. Tool UIs registered
 * by name (toolkit `render`, `useAssistantDataUI`) take precedence over
 * `ToolFallback`. When `TaskGroup` is set, tool calls that carry a nested
 * conversation and have no registered UI render through it instead of the
 * tool group; without it they render like any other tool call.
 * `ComposerExtra` renders in the composer's action row beside the attach
 * button.
 */
export type ThreadComponents = {
  AssistantMessage?: ComponentType | undefined;
  /** A component, or plain content rendered as-is in the empty thread. */
  Welcome?: ComponentType | ReactNode | undefined;
  ToolFallback?: ToolCallMessagePartComponent | undefined;
  ToolGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
  ReasoningGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
  TaskGroup?: ComponentType<{ group: ThreadGroupPart }> | undefined;
  ComposerExtra?: ComponentType | undefined;
  /** Replaces the built-in "load earlier" control; used when the runtime has no earlier-pages protocol but the host paginates history itself. */
  EarlierLoader?: ComponentType | undefined;
  /** Rendered at the end of the message flow, above the composer (pending interrupt forms). */
  Trailing?: ComponentType | undefined;
  /** Set to `null` to hide the built-in composer when the host mounts its own input below the thread. */
  Composer?: ComponentType<{ autoFocus: boolean }> | null;
};

const messageGroupBy = groupPartByType({
  reasoning: ["group-chainOfThought", "group-reasoning"],
  "tool-call": ["group-chainOfThought", "group-tool"],
  "standalone-tool-call": [],
});

type ThreadGroupKey =
  | "group-chainOfThought"
  | "group-reasoning"
  | "group-tool"
  | "group-task";

const TASK_GROUP_PATH: readonly ThreadGroupKey[] = [
  "group-chainOfThought",
  "group-task",
];

const taskAwareGroupBy = (
  part: Parameters<typeof messageGroupBy>[0],
  context?: Parameters<typeof messageGroupBy>[1],
): readonly ThreadGroupKey[] => {
  const path = messageGroupBy(part, context);
  return part.type === "tool-call" &&
    part.messages !== undefined &&
    path.length > 0 &&
    !context?.toolUIs?.[part.toolName]?.length
    ? TASK_GROUP_PATH
    : path;
};

export type ThreadProps = {
  components?: ThreadComponents | undefined;
  autoFocus?: boolean | undefined;
  afterMessages?: ReactNode;
  composer?: ReactNode;
};

const EMPTY_COMPONENTS: ThreadComponents = {};

const ThreadComponentsContext =
  createContext<ThreadComponents>(EMPTY_COMPONENTS);

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

// A switched thread that is still fetching its history: skeleton, not welcome.
const isHistoryLoadingView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  s.thread.isLoading &&
  !s.thread.isDisabled &&
  !s.threads.isLoading;

const ThreadHistorySkeleton: FC = () => {
  const { t } = useLingui();
  return (
    <div
      data-slot="aui_thread-history-skeleton"
      role="status"
      className="animate-in fade-in fill-mode-both flex flex-col gap-y-6 [animation-delay:150ms] [animation-duration:200ms]"
    >
      <span className="sr-only">{t`正在加载会话`}</span>
      <Skeleton className="ml-auto h-9 w-2/5 rounded-xl motion-reduce:animate-none" />
      <div className="flex flex-col gap-y-2">
        <Skeleton className="h-4 w-11/12 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-3/5 motion-reduce:animate-none" />
      </div>
      <Skeleton className="ml-auto h-9 w-1/3 rounded-xl motion-reduce:animate-none" />
      <div className="flex flex-col gap-y-2">
        <Skeleton className="h-4 w-10/12 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
      </div>
    </div>
  );
};

export const Thread: FC<ThreadProps> = ({
  components = EMPTY_COMPONENTS,
  autoFocus = true,
  afterMessages,
  composer,
}) => {
  const isEmpty = useAuiState(isNewChatView);

  return (
    <ThreadComponentsContext.Provider value={components}>
      <ThreadRoot
        isEmpty={isEmpty}
        autoFocus={autoFocus}
        afterMessages={afterMessages}
        composer={composer}
      />
    </ThreadComponentsContext.Provider>
  );
};

const ThreadRoot: FC<{
  isEmpty: boolean;
  autoFocus: boolean;
  afterMessages?: ReactNode;
  composer?: ReactNode;
}> = ({ isEmpty, autoFocus, afterMessages, composer }) => {
  const {
    Welcome = ThreadWelcome,
    EarlierLoader,
    Trailing,
    Composer: ComposerComponent = Composer,
  } = useContext(ThreadComponentsContext);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportContentRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const hasComposer = Boolean(composer);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = viewportContentRef.current;
    const footer = footerRef.current;
    if (!viewport || !content || !footer) return;
    const region = viewport.parentElement;
    const updateEdges = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      viewport.toggleAttribute("data-scroll-above", scrollTop > 1);
      viewport.toggleAttribute(
        "data-scroll-below",
        scrollHeight - clientHeight - scrollTop > 1,
      );
    };
    const observer = new ResizeObserver(() => {
      updateEdges();
      viewport.style.scrollPaddingBottom = `${footer.offsetHeight + 8}px`;
      const toolbar = footer.querySelector("[data-composer-toolbar]");
      if (toolbar) {
        // Both edges move with the sticky footer. Only the toolbar and its
        // bottom padding are excluded from the native scrollbar track.
        const inset =
          footer.getBoundingClientRect().bottom -
          toolbar.getBoundingClientRect().top;
        region?.style.setProperty("--thread-scrollbar-end", `${inset}px`);
      } else {
        region?.style.removeProperty("--thread-scrollbar-end");
      }
    });
    observer.observe(viewport);
    observer.observe(content);
    observer.observe(footer);
    viewport.addEventListener("scroll", updateEdges, { passive: true });
    updateEdges();
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", updateEdges);
      viewport.style.removeProperty("scroll-padding-bottom");
      region?.style.removeProperty("--thread-scrollbar-end");
    };
  }, [hasComposer]);

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-card @container flex h-full min-h-0 flex-col"
      style={
        {
          "--thread-max-width": "44rem",
          "--composer-bg":
            "color-mix(in oklab, var(--color-muted) 30%, transparent)",
          "--composer-radius": "1rem",
          "--composer-padding": "8px",
        } as React.CSSProperties
      }
    >
      <div className="aui-thread-scroll-region relative isolate flex min-h-0 flex-1 flex-col">
        <ThreadPrimitive.Viewport
          ref={viewportRef}
          turnAnchor="top"
          role="log"
          aria-relevant="additions"
          data-slot="aui_thread-viewport"
          className="relative flex min-h-0 flex-1 flex-col overflow-y-scroll scroll-smooth"
        >
          <div
            ref={viewportContentRef}
            className={cn(
              "mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-3 pt-4 @sm:px-4",
              isEmpty && !composer && "justify-center",
            )}
          >
            <AuiIf condition={isNewChatView}>
              <div className={cn(composer && "my-auto")}>
                {typeof Welcome === "function" ? <Welcome /> : Welcome}
              </div>
            </AuiIf>
            <AuiIf condition={isHistoryLoadingView}>
              <ThreadHistorySkeleton />
            </AuiIf>

            {EarlierLoader ? <EarlierLoader /> : <ThreadLoadEarlier />}

            <div
              data-slot="aui_message-group"
              className="flex flex-col gap-y-5 empty:hidden"
            >
              <ThreadPrimitive.Messages>
                {() => <ThreadMessage />}
              </ThreadPrimitive.Messages>
            </div>

            {afterMessages}
            {Trailing ? <Trailing /> : null}

            <ThreadPrimitive.ViewportFooter
              ref={footerRef}
              className={cn(
                "aui-thread-viewport-footer bg-card flex flex-col overflow-visible",
                hasComposer && "border-t border-border/60 pt-2",
                ComposerComponent && "pb-4 md:pb-6",
                (!isEmpty || composer) && "sticky bottom-0 z-10 mt-auto",
              )}
            >
              {composer && (
                <div
                  aria-hidden
                  className="aui-thread-edge aui-thread-edge-bottom aui-thread-edge-docked"
                />
              )}
              <ThreadScrollToBottom />
              {composer}
              {ComposerComponent ? (
                <ComposerComponent autoFocus={autoFocus} />
              ) : null}
            </ThreadPrimitive.ViewportFooter>
          </div>
        </ThreadPrimitive.Viewport>
        <div aria-hidden className="aui-thread-edge aui-thread-edge-top" />
        <div
          aria-hidden
          className="aui-thread-edge aui-thread-scrollbar-edge aui-thread-scrollbar-edge-start"
        />
        <div
          aria-hidden
          className="aui-thread-edge aui-thread-scrollbar-edge aui-thread-scrollbar-edge-end"
        />
        {!composer && (
          <div aria-hidden className="aui-thread-edge aui-thread-edge-bottom" />
        )}
      </div>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
    useContext(ThreadComponentsContext);
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessageComponent />;
};

const FOCUSABLE_SELECTOR =
  "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1']):not([disabled])";

const nextFocusable = (start: Element) => {
  for (
    let element = start.nextElementSibling;
    element;
    element = element.nextElementSibling
  ) {
    const target = element.matches(FOCUSABLE_SELECTOR)
      ? element
      : element.querySelector(FOCUSABLE_SELECTOR);
    if (target instanceof HTMLElement) return target;
  }
  return null;
};

const ThreadLoadEarlier: FC = () => {
  const { t } = useLingui();
  const visible = useAuiState(
    (s) => s.thread.hasEarlier || s.thread.isLoadingEarlier,
  );
  const loading = useAuiState((s) => s.thread.isLoadingEarlier);
  const slotRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef<Element | null>(null);

  // The last page removes the button; a keyboard user on it continues from the
  // next control in tab order rather than from the document body.
  useLayoutEffect(() => {
    const focused = focusedRef.current;
    const slot = slotRef.current;
    if (visible || !focused || focused.isConnected || !slot) return;
    focusedRef.current = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    nextFocusable(slot)?.focus();
  }, [visible]);

  return (
    <div
      ref={slotRef}
      className="contents"
      onFocus={(event) => {
        focusedRef.current = event.target;
      }}
    >
      <span role="status" className="sr-only">
        {loading ? t`正在加载更早的消息` : ""}
      </span>
      {visible && (
        <ThreadPrimitive.LoadEarlier asChild>
          <Button
            variant="ghost"
            size="sm"
            data-slot="aui_thread-load-earlier"
            className="aui-thread-load-earlier text-muted-foreground mb-6 self-center rounded-full"
          >
            <span
              className={cn(loading && "shimmer motion-reduce:animate-none")}
            >
              {loading ? t`正在加载更早的消息` : t`加载更早的消息`}
            </span>
          </Button>
        </ThreadPrimitive.LoadEarlier>
      )}
    </div>
  );
};

const ThreadScrollToBottom: FC = () => {
  const { t } = useLingui();
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip={t`回到最新`}
        aria-label={t`回到最新`}
        variant="outline"
        className="aui-thread-scroll-to-bottom dark:border-border dark:bg-card dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  const { t } = useLingui();
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col px-2">
      <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-medium tracking-tight duration-200">
        {t`今天想做什么？`}
      </p>
    </div>
  );
};

const Composer: FC<{ autoFocus: boolean }> = ({ autoFocus }) => {
  const { t } = useLingui();
  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <div
        data-slot="aui_composer-shell"
        className="border-foreground/10 focus-within:border-foreground/25 data-[dragging=true]:border-ring flex w-full cursor-text flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) transition-[border-color] data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))]"
      >
        <ComposerPrimitive.Input
          placeholder={t`发送消息…`}
          className="aui-composer-input caret-primary placeholder:text-muted-foreground/60 max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6 outline-none"
          rows={1}
          autoFocus={autoFocus}
          enterKeyHint="send"
          aria-label={t`消息输入`}
        />
        <ComposerAction />
      </div>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  const { t } = useLingui();
  const { ComposerExtra } = useContext(ThreadComponentsContext);
  // The stop control only cancels the send while no run it could stop is going.
  const isSending = useAuiState(
    (s) =>
      s.composer.submission !== undefined &&
      !(s.thread.isRunning && s.thread.capabilities.cancel),
  );

  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      {ComposerExtra ? (
        <div className="aui-composer-action-start flex items-center gap-1.5">
          <ComposerExtra />
        </div>
      ) : null}
      <div className="flex items-center gap-1.5">
        <AuiIf
          condition={(s) =>
            (!s.composer.canCancel ||
              (s.thread.voice !== undefined &&
                s.composer.submission === undefined)) &&
            !shouldShowComposerResume(s)
          }
        >
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip={t`发送`}
              side="bottom"
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-send size-7 rounded-full"
              aria-label={t`发送`}
            >
              <ArrowUpIcon className="aui-composer-send-icon size-4" />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={shouldShowComposerResume}>
          <ComposerPrimitive.Resume asChild>
            <TooltipIconButton
              tooltip={t`继续生成`}
              side="bottom"
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-resume size-7 rounded-full"
              aria-label={t`继续生成`}
            >
              <PlayIcon className="aui-composer-resume-icon size-4" />
            </TooltipIconButton>
          </ComposerPrimitive.Resume>
        </AuiIf>
        <AuiIf
          condition={(s) =>
            s.composer.canCancel &&
            (s.thread.voice === undefined ||
              s.composer.submission !== undefined)
          }
        >
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel size-7 rounded-full"
              aria-label={isSending ? t`取消发送` : t`停止生成`}
              data-action="agent-stop"
            >
              <SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  );
};

const MessageError: FC = () => {
  const { t } = useLingui();
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root group/error mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 py-1 text-sm text-destructive data-[run-state=in-progress]:text-muted-foreground data-[run-state=stale]:text-warning-foreground">
        <TriangleAlertIcon className="hidden size-4 shrink-0 group-data-[run-state=stale]/error:block" />
        <Loader2Icon className="hidden size-4 shrink-0 animate-spin group-data-[run-state=in-progress]/error:block motion-reduce:animate-none" />
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2 min-w-0 flex-1" />
        <ActionBarPrimitive.Resume asChild>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 gap-1.5 disabled:hidden"
          >
            <PlayIcon className="size-3.5" />
            {t`继续`}
          </Button>
        </ActionBarPrimitive.Resume>
        <ActionBarPrimitive.RefreshRun asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 disabled:hidden"
          >
            <RefreshCwIcon className="size-3.5" />
            {t`刷新`}
          </Button>
        </ActionBarPrimitive.RefreshRun>
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC<{
  hiddenToolCallIds?: ReadonlySet<string> | undefined;
  author?: string;
  showIndicator?: boolean;
  artifacts?: ReactNode;
}> = ({ hiddenToolCallIds, author, showIndicator = true, artifacts }) => {
  const { t } = useLingui();
  const {
    ToolFallback: ToolFallbackComponent = ToolFallback,
    ToolGroup,
    ReasoningGroup,
    TaskGroup: TaskGroupComponent,
  } = useContext(ThreadComponentsContext);
  const hasReply = useAuiState((s) =>
    s.message.parts.some((part) => part.type === "text" && !!part.text.trim()),
  );
  const defaultGroupBy = TaskGroupComponent ? taskAwareGroupBy : messageGroupBy;
  // Hidden leaves must stay outside tool groups so they are excluded from counts.
  const groupBy: typeof defaultGroupBy = (part, context) =>
    part.type === "tool-call" && hiddenToolCallIds?.has(part.toolCallId)
      ? []
      : defaultGroupBy(part, context);

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      data-subagent={author}
      className={cn(
        "relative",
        !artifacts &&
          "[contain-intrinsic-size:auto_200px] [content-visibility:auto]",
        !author &&
          "fade-in slide-in-from-bottom-1 animate-in duration-150 motion-reduce:animate-none",
      )}
    >
      <div
        data-slot="aui_assistant-message-content"
        className="min-w-0 space-y-1.5 leading-relaxed wrap-break-word text-foreground"
      >
        {author && hasReply && (
          <p className="text-xs font-medium leading-5 text-muted-foreground">
            {author}
          </p>
        )}
        <MessagePrimitive.GroupedParts groupBy={groupBy}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                return <div data-slot="aui_chain-of-thought">{children}</div>;
              case "group-task":
                return TaskGroupComponent ? (
                  <TaskGroupComponent group={part} />
                ) : null;
              case "group-tool":
                if (ToolGroup) {
                  return <ToolGroup group={part}>{children}</ToolGroup>;
                }
                return (
                  <DefaultToolGroup group={part}>{children}</DefaultToolGroup>
                );
              case "group-reasoning": {
                if (ReasoningGroup) {
                  return (
                    <ReasoningGroup group={part}>{children}</ReasoningGroup>
                  );
                }
                const running = part.status.type === "running";
                return (
                  <AssistantActivity
                    active={running}
                    duration={reasoningDuration(part.timing)}
                  >
                    {children}
                  </AssistantActivity>
                );
              }
              case "text":
                return <MarkdownText />;
              case "reasoning":
                return <MarkdownText />;
              case "tool-call":
                return hiddenToolCallIds?.has(part.toolCallId) ? (
                  // biome-ignore lint/complexity/noUselessFragments: Returning null would let GroupedParts render the registered tool UI.
                  <></>
                ) : (
                  (part.toolUI ?? <ToolFallbackComponent {...part} />)
                );
              case "data":
                return part.dataRendererUI;
              case "indicator":
                return showIndicator ? (
                  <AssistantActivity
                    active
                    label={t({
                      message: "正在准备回复…",
                      comment:
                        "Assistant run is active and has not started returning message content.",
                    })}
                  />
                ) : null;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>
      {artifacts}

      {!author && (
        <div
          data-slot="aui_assistant-message-footer"
          className="flex min-h-7.5 items-center pt-1.5"
        >
          <BranchPicker />
          <AssistantActionBar hasReply={hasReply} />
        </div>
      )}
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC<{ hasReply: boolean }> = ({ hasReply }) => {
  const { t } = useLingui();
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ms-1 flex gap-1 duration-200"
    >
      {hasReply && (
        <ActionBarPrimitive.Copy asChild>
          <TooltipIconButton tooltip={t`复制`}>
            <AuiIf condition={(s) => s.message.isCopied}>
              <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
            </AuiIf>
            <AuiIf condition={(s) => !s.message.isCopied}>
              <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
            </AuiIf>
          </TooltipIconButton>
        </ActionBarPrimitive.Copy>
      )}
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip={t`重新生成`}>
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip={t`更多`}
            className="data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="aui-action-bar-more-content bg-popover text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none">
              <DownloadIcon className="size-4" />
              {t`导出为 Markdown`}
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(36px,1fr)_minmax(0,max-content)] content-start gap-y-2 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-muted text-foreground rounded-lg px-3 py-2 leading-relaxed wrap-break-word empty:hidden">
          <MessagePrimitive.Parts components={{}} />
        </div>
        <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 -me-1 justify-end"
      />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="aui-user-action-edit">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-2 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root border-foreground/10 focus-within:border-foreground/25 ms-auto flex w-full max-w-[85%] cursor-text flex-col rounded-(--composer-radius) border bg-(--composer-bg) transition-[border-color]">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" className="h-8 px-3">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" className="h-8 px-3">
              Update
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};

/** The default assistant message renderer, exported for slot wrappers. */
export const ThreadAssistantMessage = AssistantMessage;
export const ThreadUserMessage = UserMessage;
