import { ComposerPrimitive } from "@assistant-ui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  ArrowUpIcon,
  Loader2Icon,
  QuoteIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
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
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          <Trans>普通草稿已保留</Trans>
        </span>
        <button
          type="button"
          className="underline underline-offset-4"
          onClick={() => {
            const answer = answerTarget
              ? document.getElementById(answerTarget)
              : null;
            answer?.scrollIntoView({ block: "nearest" });
            answer?.querySelector("textarea")?.focus({ preventScroll: true });
          }}
        >
          <Trans>返回回答</Trans>
        </button>
      </div>
    );
  return (
    <ComposerPrimitive.Root
      className="aui-composer-root"
      onSubmit={(event) => void submit(event)}
    >
      <InputGroup>
        {reference && (
          <div
            data-slot="composer-reference"
            className="m-2 flex min-w-0 items-start gap-2 self-stretch rounded-md bg-muted p-2 text-xs"
          >
            <QuoteIcon aria-hidden className="mt-1 size-3 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium" title={reference.title}>
                {reference.title} · <Trans>第 {reference.line + 1} 行</Trans>
              </p>
              <p
                className="truncate text-muted-foreground"
                title={reference.text}
              >
                {reference.text}
              </p>
            </div>
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
          </div>
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
          className="max-h-40 overflow-y-auto"
        />
        <InputGroupAddon align="block-end" data-composer-toolbar>
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
