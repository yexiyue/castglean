import { Trans, useLingui } from "@lingui/react/macro";
import { ComposerContext } from "@/components/assistant-ui/elements/composer-controls";
import { PopoverTitle } from "@/components/ui/popover";
import type { AgentPage, LlmSnapshot } from "@/lib/bindings";

/** Provider-reported latest request; never sum turns or estimate tokens from text. */
export function ContextUsage({
  snapshot,
  configuration,
}: {
  snapshot: AgentPage | null;
  configuration: LlmSnapshot | null;
}) {
  const { i18n, t } = useLingui();
  const run = snapshot?.run;
  const message = [...(snapshot?.records ?? [])]
    .reverse()
    .find((message) => message.runId === run?.id);
  const usage = message?.usage;
  const binding = run?.configuration;
  const connection = configuration?.connections.find(
    (c) => c.id === binding?.selection.connectionId,
  );
  const model = connection?.models.find(
    (m) => m.id === binding?.selection.modelId,
  );
  const input = usage?.inputTokens;
  const output = usage?.outputTokens;
  const used = input != null && output != null ? input + output : null;
  const capacity =
    connection?.revision === binding?.revision ? model?.contextWindow : null;
  const hasBreakdown = input != null && output != null && !!capacity;
  const remaining = hasBreakdown
    ? Math.max(0, capacity - input - output)
    : null;
  // Preserve the input/output proportions when usage exceeds the configured window.
  const scale = hasBreakdown ? Math.max(input + output, capacity) : 1;
  const number = (n: number | null | undefined) =>
    n == null ? "—" : n.toLocaleString(i18n.locale);
  return (
    <ComposerContext
      label={t`上下文用量`}
      fraction={hasBreakdown ? (input + output) / capacity : null}
    >
      <div className="flex flex-col gap-3" data-slot="context-usage">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <PopoverTitle>
              <Trans>上下文窗口</Trans>
            </PopoverTitle>
            <span className="text-xs text-muted-foreground tabular-nums">
              {number(used)} / {number(capacity)}
            </span>
          </div>
          <p
            className="truncate text-xs text-muted-foreground"
            title={model?.name}
          >
            <Trans>上次请求</Trans>
            {model ? ` · ${model.name}` : ""}
          </p>
        </div>
        {hasBreakdown && (
          <>
            <meter
              className="sr-only"
              aria-label={t`上下文窗口`}
              min={0}
              max={capacity}
              value={Math.min(input + output, capacity)}
              aria-valuetext={`${number(used)} / ${number(capacity)}`}
            />
            <div
              data-slot="context-breakdown"
              aria-hidden
              className="flex h-2 overflow-hidden rounded-full bg-muted ring-1 ring-border ring-inset"
            >
              <span
                className="bg-primary"
                style={{ width: `${(input / scale) * 100}%` }}
              />
              <span
                className="bg-primary/55"
                style={{ width: `${(output / scale) * 100}%` }}
              />
            </div>
          </>
        )}
        <dl className="flex flex-col gap-2 text-xs tabular-nums">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-primary"
              />
              <Trans>输入 tokens</Trans>
            </dt>
            <dd>{number(input)}</dd>
          </div>
          {usage?.cachedInputTokens != null && (
            <div className="flex items-baseline justify-between gap-2 ps-4 text-muted-foreground">
              <dt>
                <Trans>已缓存输入</Trans>
              </dt>
              <dd>{number(usage.cachedInputTokens)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-2">
            <dt className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-primary/55"
              />
              <Trans>输出 tokens</Trans>
            </dt>
            <dd>{number(output)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-muted-foreground">
            <dt className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full border bg-muted"
              />
              <Trans comment="Unused token capacity in the AI model's context window">
                剩余容量
              </Trans>
            </dt>
            <dd>{number(remaining)}</dd>
          </div>
        </dl>
        {!usage && (
          <p className="text-xs leading-5 text-muted-foreground">
            <Trans>尚无服务商用量报告，不能准确计算上下文占用。</Trans>
          </p>
        )}
        {run && !capacity && (
          <p className="text-xs leading-5 text-muted-foreground">
            <Trans>
              窗口容量未知，可在模型设置中填写。应用默认不设置输出上限。
            </Trans>
          </p>
        )}
        {snapshot && (
          <p className="border-t pt-2 text-xs text-muted-foreground">
            <Trans>累计请求 {snapshot.session.budget.requests} 次</Trans>
          </p>
        )}
      </div>
    </ComposerContext>
  );
}
