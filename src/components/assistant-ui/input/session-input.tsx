import { zodResolver } from "@hookform/resolvers/zod";
import { Trans, useLingui } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
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
  // 限定输入框焦点，保留整个 composition 生命周期防护；库另过滤 229/Process，清单设置 requireReset。
  useHotkey(
    appHotkeys["session.send"],
    () => {
      if (!composing.current) void submit();
    },
    { target: textarea },
  );
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
      <InputGroup>
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
              className="max-h-40 min-h-24"
            />
          )}
        />
        <InputGroupAddon align="block-end" className="flex-wrap">
          {toolbar}
          <span className="sr-only">
            <Trans>⌘ / Ctrl + Enter 发送</Trans>
          </span>
          <span className="ml-auto" />
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
              title={t`⌘ / Ctrl + Enter 发送`}
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
