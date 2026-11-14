import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
import { ArrowRightIcon, CheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import { PageShell } from "@/components/page-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { useModelResources } from "@/hooks/use-model-resources";
import { useDesktopSession } from "@/lib/desktop-session";
import { useLocalProjects } from "@/lib/local-projects";
import { variantOf } from "@/lib/models";

function GuideStep({
  index,
  title,
  description,
  status,
  children,
}: {
  index: number;
  title: string;
  description: string;
  status?: "complete" | "loading" | "error" | "unavailable";
  children: ReactNode;
}) {
  return (
    <li className="border-border rounded-item flex items-start gap-4 border-b px-2 py-4">
      <span className="text-muted-foreground flex size-6 shrink-0 items-center justify-center text-sm tabular-nums">
        {status === "complete" ? (
          <CheckIcon aria-hidden="true" className="size-4" />
        ) : (
          index
        )}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        {status && (
          <p className="text-muted-foreground mt-1 text-xs" role="status">
            {status === "complete" ? (
              <Trans>已完成</Trans>
            ) : status === "loading" ? (
              <Trans>正在检查状态…</Trans>
            ) : status === "error" ? (
              <Trans>无法读取状态</Trans>
            ) : (
              <Trans>需要桌面应用检查状态</Trans>
            )}
          </p>
        )}
        <p className="text-muted-foreground mt-1 max-w-lg text-sm leading-6">
          {description}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">{children}</div>
      </div>
    </li>
  );
}

export function StartGuide() {
  const { t } = useLingui();
  const { openSettings } = useDesktopSession();
  const {
    entries,
    loading: modelsLoading,
    error: modelsError,
  } = useModelResources();
  const {
    projects,
    loading: projectsLoading,
    loadError: projectsError,
  } = useLocalProjects();
  const ready = entries.some((entry) => variantOf(entry.resource) === "Ready");
  return (
    <PageShell
      active="start"
      title={t({ comment: "首次使用指引", message: "快速上手" })}
      description={t({ message: "先导入原文，再准备声音模型。" })}
    >
      <div className="mx-auto max-w-6xl p-5">
        <p className="text-muted-foreground text-sm leading-6">
          <Trans>先导入章节。模型可以稍后准备，不影响阅读和整理原文。</Trans>
        </p>
        <ol className="mt-2 max-w-3xl">
          <GuideStep
            index={1}
            status={
              !isTauri()
                ? "unavailable"
                : projectsLoading
                  ? "loading"
                  : projectsError
                    ? "error"
                    : projects.some((project) => project.chapterCount > 0)
                      ? "complete"
                      : undefined
            }
            title={t({ comment: "上手第一步", message: "导入第一章" })}
            description={t({
              message: "新建工程，选择 TXT 并确认编码，再检查章节标题与顺序。",
            })}
          >
            <Link to="/new" className={buttonVariants()}>
              <Trans comment="新建工程并导入第一章">新建工程</Trans>
              <ArrowRightIcon />
            </Link>
            <Link
              to="/project/$id"
              params={{ id: "sample" }}
              className={buttonVariants({ variant: "ghost" })}
            >
              <Trans comment="先浏览演示工程">打开示例</Trans>
            </Link>
          </GuideStep>
          <GuideStep
            index={2}
            status={
              !isTauri()
                ? "unavailable"
                : modelsLoading
                  ? "loading"
                  : modelsError
                    ? "error"
                    : ready
                      ? "complete"
                      : undefined
            }
            title={t({ comment: "上手第二步", message: "准备声音模型" })}
            description={
              !isTauri()
                ? t({
                    message:
                      "模型下载和声音试听需要桌面应用。浏览器中可以先体验章节工作台。",
                  })
                : t({
                    message:
                      "在模型中心选择支持所需声音能力的模型，确认下载后准备资源。",
                  })
            }
          >
            <Link
              to="/models"
              className={buttonVariants({ variant: "outline" })}
            >
              <Trans comment="进入本机模型资源目录">模型中心</Trans>
            </Link>
          </GuideStep>
          <GuideStep
            index={3}
            title={t({ comment: "上手第三步", message: "确认存储位置" })}
            description={t({
              message:
                "在开始下载前确认模型目录。下载源和访问凭据也在这里设置。",
            })}
          >
            <Button variant="outline" onClick={() => openSettings("storage")}>
              <Trans comment="打开存储偏好">存储设置</Trans>
            </Button>
          </GuideStep>
        </ol>
      </div>
    </PageShell>
  );
}
