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
}: {
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
          {active ? (
            <InputGroupButton
              type="button"
              size="sm"
              variant="outline"
              disabled={stopping}
              onClick={() => void onStop()}
            >
              <SquareIcon />
              {stopping ? <Trans>正在停止</Trans> : <Trans>停止</Trans>}
            </InputGroupButton>
          ) : (
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
