import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function SessionInput({
  label,
  placeholder,
  suggestion,
  disabled,
  active,
  onSend,
  onStop,
}: {
  label: string;
  placeholder: string;
  suggestion: { label: string; text: string };
  disabled: boolean;
  active: boolean;
  onSend: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const [input, setInput] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || active || !input.trim()) return;
        const text = input;
        setInput("");
        void onSend(text);
      }}
    >
      <Textarea
        maxLength={4000}
        aria-label={label}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder={placeholder}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={disabled || active || !input.trim()}>
          <Trans comment="向当前 AI 会话发送说明">发送</Trans>
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={active}
          onClick={() => setInput(suggestion.text)}
        >
          {suggestion.label}
        </Button>
        {active ? (
          <Button type="button" variant="outline" onClick={() => void onStop()}>
            <Trans comment="持久取消当前后台 AI 执行">停止</Trans>
          </Button>
        ) : null}
      </div>
    </form>
  );
}
