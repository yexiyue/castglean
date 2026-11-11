import { useLingui } from "@lingui/react/macro";
import type {
  AdvertisedReasoning,
  ModelReasoning,
  ReasoningSetting,
} from "@/lib/bindings";

/** 档位显示标签；渲染时构建（模块级调用 t 早于 i18n 激活且会冻结语言）。
 * 宿主提供允许清单，浏览器不从模型名推断能力。 */
export function useReasoningLabels(): Record<ReasoningSetting, string> {
  const { t } = useLingui();
  return {
    lowest: t`自动（最低支持档位）`,
    provider_default: t`服务商默认`,
    off: t`关闭思考`,
    minimal: t({
      comment: "思考强度 minimal 档，低于 low",
      message: "极低",
    }),
    low: t({ comment: "模型思考强度 low 档", message: "低" }),
    medium: t({ comment: "模型思考强度 medium 档", message: "中" }),
    high: t({ comment: "模型思考强度 high 档", message: "高" }),
    xhigh: t({
      comment: "思考强度 xhigh 档，高于 high、低于 max",
      message: "很高",
    }),
    max: t({ comment: "模型思考强度 max 档", message: "最高" }),
  };
}

/** 某模型在目录中支持的显式档位（不含 lowest/provider_default 这两个元档）。 */
export function reasoningChoices(
  catalog: ModelReasoning[] | undefined,
  protocol: string,
  modelId: string,
  advertised?: AdvertisedReasoning | null,
): ReasoningSetting[] {
  const choices =
    advertised?.levels ??
    catalog?.find(
      (entry) => entry.protocol === protocol && entry.modelId === modelId,
    )?.choices ??
    [];
  return choices.filter(
    (choice) => choice !== "lowest" && choice !== "provider_default",
  );
}
