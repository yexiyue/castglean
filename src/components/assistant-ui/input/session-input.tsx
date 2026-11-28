import { ComposerPrimitive } from "@assistant-ui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowUpIcon, Loader2Icon, SquareIcon, XIcon } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { QuoteBlock } from "@/components/assistant-ui/elements/quote-block";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { appHotkeys } from "@/lib/hotkeys";

/** Thread composer with host-owned drafts and durable task actions. */
export function SessionInput({
  label,
  placeholder,
  value,
  onChange,
  disabled,
  active,
  stopping,
  onSend,
  onStop,
  toolbar,
  reference,
  focusToken,
  answering,
  answerTarget,
}: {
  answering?: boolean;
  answerTarget?: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  active: boolean;
  stopping?: boolean;
  onSend: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
  toolbar?: ReactNode;
  reference?: {
    title: string;
    line: number;
    text: string;
    onRemove: () => void;
  };
  focusToken?: object | null;
}) {
  const { t } = useLingui();
  const sending = useRef(false);
  const [requestingStop, setRequestingStop] = useState(false);
  const stopPending = stopping || requestingStop;
  const stopLabel = stopPending ? t`正在停止` : t`停止生成`;
  const composing = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const previousAnswering = useRef(answering);
  useEffect(() => {
    if (previousAnswering.current && !answering)
      textarea.current?.focus({ preventScroll: true });
    previousAnswering.current = answering;
  }, [answering]);
  useEffect(() => {
    if (focusToken) textarea.current?.focus({ preventScroll: true });
  }, [focusToken]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    // The host preserves the draft until the request has been accepted.
    event.preventDefault();
    if (
      disabled ||
      active ||
      sending.current ||
      composing.current ||
      !value.trim()
    )
      return;
    sending.current = true;
    try {
      await onSend(value);
    } finally {
      sending.current = false;
    }
  }
  async function stop() {
    setRequestingStop(true);
    try {
      await onStop();
    } finally {
      setRequestingStop(false);
    }
  }
  if (answering && !active)
    return (
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          <Trans>普通草稿已保留</Trans>
        </span>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            const answer = answerTarget
              ? (document.getElementById(`${answerTarget}-casting`) ??
                document.getElementById(answerTarget))
              : null;
            if (!answer) return;
            const trigger = answer.querySelector<HTMLButtonElement>(
              "[data-casting-approval-trigger]",
            );
            if (trigger?.getAttribute("aria-expanded") === "false")
              trigger.click();
            requestAnimationFrame(() => {
              if (!answer.isConnected) return;
              answer.scrollIntoView({ block: "nearest" });
              const field = answer.querySelector<HTMLElement>(
                trigger
                  ? '[role="checkbox"]:not(:disabled):not([aria-disabled="true"])'
                  : "textarea",
              );
              const destination = field ?? trigger;
              destination?.scrollIntoView({ block: "nearest" });
              destination?.focus({ preventScroll: true });
            });
          }}
        >
          <Trans>返回回答</Trans>
        </Button>
      </div>
    );
  return (
    <ComposerPrimitive.Root
      className="aui-composer-root"
      onSubmit={(event) => void submit(event)}
    >
      <InputGroup data-assistant-composer className="rounded-xl bg-background">
        {reference && (
          <QuoteBlock
            title={
              <span title={reference.title}>
                {reference.title} · <Trans>第 {reference.line + 1} 行</Trans>
              </span>
            }
            text={reference.text}
            actions={
              <InputGroupButton
                size="icon-xs"
                aria-label={t`移除原文引用`}
                onClick={() => {
                  reference.onRemove();
                  textarea.current?.focus({ preventScroll: true });
                }}
              >
                <XIcon />
              </InputGroupButton>
            }
          />
        )}
        <ComposerPrimitive.Input
          render={<InputGroupTextarea />}
          ref={textarea}
          value={value}
          aria-label={label}
          placeholder={placeholder}
          enterKeyHint="send"
          cancelOnEscape={false}
          submitMode="none"
          onChange={(event) => onChange(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (
              event.key !== appHotkeys["session.send"].hotkey ||
              event.shiftKey
            )
              return;
            // WebKit can dispatch compositionend before the confirming Enter.
            if (
              composing.current ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229
            )
              return;
            event.preventDefault();
            if (!event.repeat && !disabled && !active)
              event.currentTarget.form?.requestSubmit();
          }}
          rows={2}
          className="max-h-40 overflow-y-auto leading-relaxed"
        />
        <InputGroupAddon
          align="block-end"
          data-composer-toolbar
          className="gap-1 px-2.5"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {toolbar}
          </div>
          {active ? (
            <InputGroupButton
              size="icon-sm"
              variant="default"
              data-action="agent-stop"
              className="shrink-0"
              aria-label={stopLabel}
              title={stopLabel}
              disabled={stopPending}
              onClick={() => void stop()}
            >
              {stopPending ? (
                <Loader2Icon className="animate-spin motion-reduce:animate-none" />
              ) : (
                <SquareIcon className="size-3.5 fill-current" />
              )}
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              className="shrink-0"
              aria-label={t`发送`}
              title={t`Enter 发送 · Shift + Enter 换行`}
              disabled={disabled || !value.trim()}
            >
              <ArrowUpIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </ComposerPrimitive.Root>
  );
}
