import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, MonitorIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 浏览器（非桌面宿主）打开应用时的统一引导：说明能力边界、
 * 给出示例工程入口。替代各页临时的降级提示。
 * 与“宿主不可用 / 真实空目录 / 读取失败”是不同状态，不混用。
 */
export function BrowserPreviewGuide({
  summary,
  actions,
  className,
}: {
  /** 本页在桌面应用中提供的核心能力，一句话。 */
  summary: ReactNode;
  /** 页面特有的补充行动（如打开设置分区）。 */
  actions?: ReactNode;
  className?: string;
}) {
  const { t } = useLingui();
  return (
    <section
      aria-label={t({
        comment: "浏览器打开时的能力边界引导",
        message: "浏览器预览说明",
      })}
      className={cn(
        "border-border bg-card mx-auto flex w-full max-w-xl flex-col items-center gap-5 rounded-lg border px-8 py-14 text-center",
        className,
      )}
    >
      <div className="bg-accent text-accent-foreground flex size-11 items-center justify-center rounded-full">
        <MonitorIcon className="size-5" strokeWidth={1.75} />
      </div>
      <div className="flex max-w-sm flex-col gap-2">
        <h2 className="text-sm font-medium">
          <Trans comment="浏览器预览引导标题">
            当前是浏览器预览，完整功能在桌面应用中
          </Trans>
        </h2>
        <p className="text-muted-foreground text-sm leading-6">{summary}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          nativeButton={false}
          render={<Link to="/project/$id" params={{ id: "sample" }} />}
        >
          <Trans comment="在浏览器中打开示例小说工程">打开示例工程</Trans>
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
        <Button
          variant="ghost"
          nativeButton={false}
          render={<Link to="/start" />}
        >
          <Trans comment="查看首次使用指引">快速上手</Trans>
        </Button>
        {actions}
      </div>
    </section>
  );
}
