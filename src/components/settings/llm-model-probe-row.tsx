import { Trans, useLingui } from "@lingui/react/macro";
import { LoaderCircleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LlmConnection, LlmModel, ProbeKind } from "@/lib/bindings";
import { llmErrors } from "@/lib/llm";

/** 阶梯测试顺序：任一步失败即停，后续能力不再发起。 */
export const probeKinds = ["connection", "tools", "structured"] as const;

export function LlmModelProbeRow({
  connection,
  model,
  isDefault,
  isProbingThis,
  busy,
  onDefault,
  onCancel,
  onTest,
}: {
  connection: LlmConnection;
  model: LlmModel;
  isDefault: boolean;
  isProbingThis: boolean;
  busy: boolean;
  onDefault: () => void;
  onCancel: () => void;
  onTest: () => void;
}) {
  const { t, i18n } = useLingui();
  function kindLabel(kind: ProbeKind) {
    return kind === "connection"
      ? t({ comment: "连接测试类别简称", message: "连接" })
      : kind === "tools"
        ? t({ comment: "工具测试类别简称", message: "工具" })
        : t({ comment: "结构化测试类别简称", message: "结构化" });
  }
  const failures = connection.probes.filter(
    (probe) =>
      probe.modelId === model.id &&
      probe.revision === connection.revision &&
      probe.failure,
  );
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm">
        <span className="min-w-0 break-all">{model.name}</span>
        {model.modelId !== model.name && (
          <code className="text-xs break-all text-muted-foreground">
            {model.modelId}
          </code>
        )}
        {isDefault ? (
          <Badge variant="secondary">
            <Trans comment="当前全局默认模型标记">默认</Trans>
          </Badge>
        ) : (
          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            aria-label={t`将 ${model.name} 设为默认模型`}
            onClick={onDefault}
          >
            <Trans comment="设为全局默认 LLM">设为默认</Trans>
          </Button>
        )}
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          {probeKinds.map((kind) => {
            const result = connection.probes.find(
              (probe) => probe.modelId === model.id && probe.kind === kind,
            );
            const status = !result
              ? t({
                  comment: "模型能力尚无测试记录",
                  message: "未测试",
                })
              : result.revision !== connection.revision
                ? t({
                    comment: "配置变化后旧测试失效",
                    message: "已过期",
                  })
                : result.failure
                  ? t({
                      comment: "模型测试未通过",
                      message: "失败",
                    })
                  : t({
                      comment: "模型测试通过",
                      message: "通过",
                    });
            const variant = !result
              ? "outline"
              : result.revision !== connection.revision
                ? "outline"
                : result.failure
                  ? "destructive"
                  : "secondary";
            return (
              <Badge
                key={kind}
                variant={variant}
                title={
                  result
                    ? `${status}${result.failure ? `：${i18n._(llmErrors[result.failure])}` : ""} · ${new Date(Number(result.testedAt) * 1000).toLocaleString()}`
                    : undefined
                }
              >
                {kindLabel(kind)} · {status}
              </Badge>
            );
          })}
          {isProbingThis ? (
            <Button variant="outline" size="sm" onClick={onCancel}>
              <span
                data-icon="inline-start"
                className="motion-safe:animate-spin"
              >
                <LoaderCircleIcon />
              </span>
              <Trans comment="停止当前模型能力测试">停止测试</Trans>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={t`测试模型 ${model.name}`}
              onClick={onTest}
            >
              <Trans comment="对单个模型运行连接、工具与结构化阶梯测试">
                运行测试
              </Trans>
            </Button>
          )}
        </div>
      </div>
      {failures.length ? (
        <ul className="space-y-0.5">
          {failures.map((probe) => (
            <li key={probe.kind} className="text-xs text-destructive">
              {kindLabel(probe.kind)}：
              {probe.failure ? i18n._(llmErrors[probe.failure]) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
