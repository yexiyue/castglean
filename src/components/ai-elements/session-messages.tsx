import { Trans, useLingui } from "@lingui/react/macro";
import type { UIMessage } from "ai";
import { Message, MessageContent } from "@/components/ai-elements/message";

/** Shared presentation; host result references are rendered by the owning workflow. */
export function SessionMessages({
  messages,
  label,
}: {
  messages: UIMessage[];
  label: string;
}) {
  const { t } = useLingui();
  return (
    <div
      role="log"
      aria-label={label}
      className="max-h-[28rem] overflow-auto border-y"
    >
      {messages.map((message) => (
        <Message key={message.id} from={message.role}>
          <span className="text-muted-foreground text-xs">
            {message.role === "user" ? t`你` : t`助手`}
          </span>
          <MessageContent>
            {message.parts.map((part, index) =>
              part.type === "text" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: Host part ordinals are append-only within the stable message.
                <p key={index}>{part.text}</p>
              ) : part.type === "dynamic-tool" ? (
                <details
                  key={part.toolCallId}
                  className="border-l pl-3 text-xs"
                >
                  <summary className="cursor-pointer">
                    {part.toolName} ·{" "}
                    {part.state === "output-available"
                      ? t`已完成`
                      : part.state === "output-error"
                        ? t`未完成`
                        : t`执行中`}
                  </summary>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
                    {JSON.stringify(part.input, null, 2)}
                  </pre>
                  {part.state === "output-available" ? (
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
                      {JSON.stringify(part.output, null, 2)}
                    </pre>
                  ) : null}
                  {part.state === "output-error" ? (
                    <p>
                      <Trans>工具未完成，已有结果仍保留。</Trans>
                    </p>
                  ) : null}
                </details>
              ) : null,
            )}
          </MessageContent>
        </Message>
      ))}
    </div>
  );
}
