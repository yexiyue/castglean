import { Trans } from "@lingui/react/macro";

/** 主流程提示：导入原文到生成音频的四个阶段，空态与首启引导共用。 */
export function ProjectFlowHint() {
  return (
    <span className="mt-1.5 block text-xs text-muted-foreground/80">
      <Trans comment="空态与首启引导共用的流程提示">
        导入原文 → 检查章节 → 绑定声音 → 生成音频
      </Trans>
    </span>
  );
}
