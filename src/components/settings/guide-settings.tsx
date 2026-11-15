import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * 使用指南：常驻可复看的主流程说明与入口。
 * 与首次使用引导相互独立，不依赖首启状态，也不改动工程数据。
 */
export function GuideSettings({
  onSectionChange,
}: {
  onSectionChange: (section: string) => void;
}) {
  const { t } = useLingui();
  const steps = [
    {
      id: "import",
      title: t({ comment: "使用指南第一步标题", message: "导入原文" }),
      description: t({
        comment: "使用指南第一步说明",
        message: "新建工程并选择 TXT；导入后自动分章并保存在本机。",
      }),
      action: (
        <Link
          to="/new"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <Trans comment="使用指南：进入新建工程">新建工程</Trans>
        </Link>
      ),
    },
    {
      id: "chapters",
      title: t({ comment: "使用指南第二步标题", message: "检查章节" }),
      description: t({
        comment: "使用指南第二步说明",
        message: "打开工程确认章节标题与顺序，必要时人工调整后再继续。",
      }),
      action: (
        <Link
          to="/"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <Trans comment="使用指南：回到工程列表">工程首页</Trans>
        </Link>
      ),
    },
    {
      id: "voices",
      title: t({ comment: "使用指南第三步标题", message: "绑定声音" }),
      description: t({
        comment: "使用指南第三步说明",
        message:
          "在模型中心准备支持所需声音能力的模型，在音色中心挑选或创建音色。",
      }),
      action: (
        <>
          <Link
            to="/models"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Trans comment="使用指南：进入模型中心">模型中心</Trans>
          </Link>
          <Link
            to="/voices"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Trans comment="使用指南：进入音色中心">音色中心</Trans>
          </Link>
        </>
      ),
    },
    {
      id: "produce",
      title: t({ comment: "使用指南第四步标题", message: "生成与导出" }),
      description: t({
        comment: "使用指南第四步说明",
        message: "在章节工作台生成音频、试听调整，满意后导出带走。",
      }),
      action: null,
    },
  ];
  return (
    <section className="space-y-6">
      <p className="text-sm leading-6 text-muted-foreground">
        <Trans comment="使用指南开头说明">
          模型可以稍后准备，导入原文不以模型准备为前提。
        </Trans>
      </p>
      <ol className="divide-y divide-border">
        {steps.map((step, index) => (
          <li key={step.id} className="flex flex-wrap items-start gap-4 py-4">
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center text-sm text-muted-foreground tabular-nums"
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold">{step.title}</h4>
              <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
                {step.description}
              </p>
            </div>
            {step.action ? (
              <div className="flex flex-wrap items-center gap-2">
                {step.action}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">
          <Trans comment="使用指南中的存储位置说明">
            下载模型前确认模型目录；下载源和访问凭据也在存储位置设置。
          </Trans>
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSectionChange("storage")}
        >
          <Trans comment="使用指南：打开存储位置分区">存储位置</Trans>
        </Button>
      </div>
    </section>
  );
}
