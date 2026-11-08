import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";

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
  useEffect(() => {
    if (focusToken) textarea.current?.focus({ preventScroll: true });
  }, [focusToken]);
  async function submit() {
    if (disabled || active || sending.current || !value.trim()) return;
    sending.current = true;
    try {
      await onSend(value);
    } finally {
      sending.current = false;
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          ref={textarea}
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="max-h-40 min-h-24 px-3 leading-6"
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              !event.nativeEvent.isComposing &&
              !composing.current &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <InputGroupAddon align="block-end">
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
