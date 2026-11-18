import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowUpIcon, QuoteIcon, SquareIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { appHotkeys } from "@/lib/hotkeys";

const messageSchema = z.object({
  message: z.string().refine((value) => !!value.trim()),
});

/** shadcn Prompt Input composition. Business state stays with the session owner. */
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
  taskOwnsStop,
}: {
  answering?: boolean;
  answerTarget?: string;
  taskOwnsStop?: boolean;
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
  const composing = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const previousAnswering = useRef(answering);
  useEffect(() => {
    if (previousAnswering.current && !answering)
      textarea.current?.focus({ preventScroll: true });
    previousAnswering.current = answering;
  }, [answering]);
  const form = useForm({
    resolver: zodResolver(messageSchema),
    values: { message: value },
  });
  useEffect(() => {
    if (focusToken) textarea.current?.focus({ preventScroll: true });
  }, [focusToken]);
  async function send(message: string) {
    if (disabled || active || sending.current || composing.current) return;
    sending.current = true;
    try {
      await onSend(message);
    } finally {
      sending.current = false;
    }
  }
  const submit = form.handleSubmit(({ message }) => send(message));
  if (answering)
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
    <form onSubmit={submit}>
      <InputGroup appearance="composer">
        {reference && (
          <div
            data-slot="composer-reference"
            className="mx-3 mt-3 flex max-w-full items-start gap-2 self-stretch rounded-item bg-muted px-2 py-1 text-xs"
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
        <Controller
          control={form.control}
          name="message"
          render={({ field }) => (
            <InputGroupTextarea
              {...field}
              ref={(node) => {
                textarea.current = node;
                field.ref(node);
              }}
              aria-label={label}
              placeholder={placeholder}
              onChange={(event) => {
                field.onChange(event);
                onChange(event.target.value);
              }}
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
                if (!event.repeat && !disabled && !active) void submit();
              }}
              rows={2}
              className="max-h-40 overflow-y-auto"
            />
          )}
        />
        <InputGroupAddon align="block-end">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {toolbar}
          </div>
          {active && !taskOwnsStop ? (
            <InputGroupButton
              type="button"
              size="sm"
              variant="outline"
              data-action="agent-stop"
              disabled={stopping}
              onClick={() => void onStop()}
            >
              <SquareIcon />
              {stopping ? <Trans>正在停止</Trans> : <Trans>停止</Trans>}
            </InputGroupButton>
          ) : active ? null : (
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              aria-label={t`发送`}
              title={t`Enter 发送 · Shift + Enter 换行`}
              disabled={disabled || !value.trim()}
            >
              <ArrowUpIcon />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
