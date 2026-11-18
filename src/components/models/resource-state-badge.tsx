import { useLingui } from "@lingui/react/macro";
import { Badge } from "@/components/ui/badge";
import type { ResourceState } from "@/lib/bindings";
import { stateLabel, variantOf } from "@/lib/models";

/** 资源状态徽章：就绪=成功色、进行中=信息色、暂停/部分=警告、失败=错误、未准备=中性。 */
export function ResourceStateBadge({ resource }: { resource: ResourceState }) {
  const { t } = useLingui();
  const label = stateLabel(resource);
  const variant = variantOf(resource);
  const badgeVariant =
    variant === "Ready"
      ? "secondary"
      : variant === "Downloading" || variant === "Preparing"
        ? "secondary"
        : variant === "Paused" || variant === "Partial"
          ? "outline"
          : variant === "Failed"
            ? "destructive"
            : "outline";
  return <Badge variant={badgeVariant}>{t(label.label)}</Badge>;
}
