import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { ComposerContext } from "@/components/assistant-ui/elements/composer-controls";
import { ContextBreakdown } from "@/components/assistant-ui/elements/context-breakdown";
import { Button } from "@/components/ui/button";
import { PopoverTitle } from "@/components/ui/popover";
import { activeRun } from "@/lib/ai";
import type { AgentPage, LlmSnapshot } from "@/lib/bindings";

/** Provider-reported latest request; never sum turns or estimate tokens from text. */
export function ContextUsage({
  snapshot,
  configuration,
  compactDisabled,
  onCompact,
}: {
  snapshot: AgentPage | null;
  configuration: LlmSnapshot | null;
  compactDisabled?: boolean;
  onCompact?: () => Promise<void>;
}) {
  const { i18n, t } = useLingui();
  const run = snapshot?.run;
  const [starting, setStarting] = useState(false);
  const manual = run?.workspaceContext?.action === "compact";
  const compacting = starting || (manual && activeRun(run));
  const summaryRunId = snapshot?.session.contextCompactionRunId;
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
        {hasBreakdown ? (
          <ContextBreakdown
            label={t`上下文窗口`}
            limit={capacity}
            segments={[
              { label: t`输入 tokens`, tokens: input, tint: "bg-primary" },
              { label: t`输出 tokens`, tokens: output, tint: "bg-primary/55" },
            ]}
          />
        ) : (
          <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 text-xs tabular-nums">
            <dt>
              <Trans>输入 tokens</Trans>
            </dt>
            <dd>{number(input)}</dd>
            <dt>
              <Trans>输出 tokens</Trans>
            </dt>
            <dd>{number(output)}</dd>
          </dl>
        )}
        {usage?.cachedInputTokens != null && (
          <dl className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground tabular-nums">
            <dt>
              <Trans>已缓存输入</Trans>
            </dt>
            <dd>{number(usage.cachedInputTokens)}</dd>
          </dl>
        )}
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
        {onCompact && (
          <div className="flex flex-col items-start gap-2 border-t pt-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={compacting || compactDisabled}
              onClick={() => {
                setStarting(true);
                void onCompact().finally(() => setStarting(false));
              }}
            >
              {compacting ? (
                <Trans comment="An in-progress command that summarizes older AI conversation turns">
                  正在压缩上下文…
                </Trans>
              ) : (
                <Trans comment="Button that summarizes older AI conversation turns for the model">
                  压缩上下文
                </Trans>
              )}
            </Button>
            <p
              role="status"
              className="text-xs leading-5 text-muted-foreground"
            >
              {manual &&
              run?.status === "succeeded" &&
              summaryRunId !== run.id ? (
                <Trans>没有更多可压缩的旧轮次。</Trans>
              ) : summaryRunId ? (
                <Trans>旧轮次已压缩，完整聊天记录仍可查看。</Trans>
              ) : (
                <Trans>保留完整聊天记录，只压缩发给模型的旧轮次。</Trans>
              )}
            </p>
          </div>
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
