import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, BookOpenIcon } from "lucide-react";
import { ProjectFlowHint } from "@/components/projects/project-flow-hint";
import { Button, buttonVariants } from "@/components/ui/button";
import type { FirstRunStep } from "@/lib/first-run-step";

/**
 * 首次使用引导层：只把用户带到「看到章节列表」这一步。
 * 不阻断导航，不呈现伪造的进度或成功状态。
 */
export function FirstRunGuide({
  step,
  draftId,
  onSkip,
}: {
  step: Exclude<FirstRunStep, "done">;
  draftId?: string;
  onSkip: () => void;
}) {
  const { t } = useLingui();
  const continueDraft = step === "draft" ? draftId : undefined;
  return (
    <section
      aria-label={t({ comment: "首次使用引导层", message: "首次使用引导" })}
      className="flex flex-col gap-4 rounded-surface border border-border bg-card p-5"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-item bg-accent text-accent-foreground"
        >
          <BookOpenIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            <Trans comment="首次使用引导标题">开始第一本书</Trans>
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
            {step === "draft" ? (
              <Trans comment="首次使用引导：已有未完成草案">
                继续完成导入，章节列表出现后就可以绑定声音并生成音频。
              </Trans>
            ) : (
              <Trans comment="首次使用引导：还没有工程">
                导入 TXT 小说，CastGlean
                自动分章并保存在本机。模型可以稍后准备，不影响整理原文。
              </Trans>
            )}
          </p>
          <ProjectFlowHint />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/new"
          search={continueDraft ? { draft: continueDraft } : {}}
          className={buttonVariants()}
        >
          {continueDraft ? (
            <Trans comment="首次使用引导：继续未完成的导入">继续导入</Trans>
          ) : (
            <Trans comment="首次使用引导：创建第一个工程">新建工程</Trans>
          )}
          <ArrowRightIcon data-icon="inline-end" />
        </Link>
        <Button variant="ghost" onClick={onSkip}>
          <Trans comment="首次使用引导：跳过引导">跳过</Trans>
        </Button>
      </div>
    </section>
  );
}
