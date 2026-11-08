import { Trans, useLingui } from "@lingui/react/macro";
import type { HistoryPage, LlmSnapshot } from "@/lib/bindings";

/** Provider-reported latest request; never sum turns or estimate tokens from text. */
export function ContextUsage({
  snapshot,
  configuration,
}: {
  snapshot: HistoryPage | null;
  configuration: LlmSnapshot | null;
}) {
  const { i18n, t } = useLingui();
  const run = snapshot?.run;
  const message = [...(snapshot?.messages ?? [])]
    .reverse()
    .find(
      (message) => message.role === "assistant" && message.runId === run?.id,
    );
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
  const ratio = used != null && capacity ? used / capacity : null;
  const number = (n: number | null | undefined) =>
    n == null ? "—" : n.toLocaleString(i18n.locale);
  return (
    <div className="flex flex-col gap-3" data-slot="context-usage">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>
          <Trans>上下文窗口</Trans>
        </span>
        <span className="font-medium tabular-nums">
          {ratio != null ? (
            `${(ratio * 100).toLocaleString(i18n.locale, { maximumFractionDigits: 1 })}%`
          ) : (
            <Trans>未知</Trans>
          )}
        </span>
      </div>
      {ratio != null && (
        <div
          role="progressbar"
          aria-label={t`上下文窗口`}
          aria-valuenow={Math.min(ratio * 100, 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
        >
          <div
            className="bg-primary h-full rounded-full"
            style={{ width: `${Math.min(ratio * 100, 100)}%` }}
          />
        </div>
      )}
      <p className="text-muted-foreground text-xs leading-5">
        <Trans>上次请求</Trans>
        {model ? ` · ${model.name}` : ""}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs tabular-nums">
        <dt className="text-muted-foreground">
          <Trans>输入 tokens</Trans>
        </dt>
        <dd className="text-right">{number(input)}</dd>
        <dt className="text-muted-foreground">
          <Trans>输出 tokens</Trans>
        </dt>
        <dd className="text-right">{number(output)}</dd>
        <dt className="text-muted-foreground">
          <Trans>已缓存输入</Trans>
        </dt>
        <dd className="text-right">{number(usage?.cachedInputTokens)}</dd>
        <dt className="text-muted-foreground">
          <Trans>占用 / 窗口</Trans>
        </dt>
        <dd className="text-right">
          {number(used)} / {number(capacity)}
        </dd>
      </dl>
      <p className="text-muted-foreground text-xs leading-5">
        {usage ? (
          <Trans>
            服务商报告的最近一次请求用量，包含系统提示、历史与工具；缓存已包含在输入中。
          </Trans>
        ) : (
          <Trans>尚无服务商用量报告，不能准确计算上下文占用。</Trans>
        )}
      </p>
      {!capacity && (
        <p className="text-muted-foreground text-xs leading-5">
          <Trans>
            窗口容量未知，可在模型设置中填写。应用默认不设置输出上限。
          </Trans>
        </p>
      )}
      {snapshot && (
        <p className="text-muted-foreground border-t pt-2 text-xs">
          <Trans>累计请求 {snapshot.session.budget.requests} 次</Trans>
        </p>
      )}
    </div>
  );
}
