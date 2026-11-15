import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon, BookOpenIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { AppState } from "@/components/app-state";
import { BrowserPreviewGuide } from "@/components/browser-preview-guide";
import { FirstRunGuide } from "@/components/onboarding/first-run-guide";
import { PageShell } from "@/components/page-shell";
import { ProjectCardContent } from "@/components/projects/project-card";
import { ProjectFlowHint } from "@/components/projects/project-flow-hint";
import { Button, buttonVariants } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import type { LocalProjectListItem } from "@/lib/bindings";
import { firstRunStep } from "@/lib/first-run-step";
import { desktop, useLocalProjects } from "@/lib/local-projects";
import { useOnboardingState } from "@/lib/onboarding-state";
import { cn } from "@/lib/utils";

/** 搜索只在工程多到值得筛选时出现；阈值下靠卡片直接扫读。 */
const searchThreshold = 4;

function HomePage() {
  const { t } = useLingui();
  const { projects, draft, loadError, loading } = useLocalProjects();
  const {
    loading: appStateLoading,
    onboardingCompleted,
    completeOnboarding,
  } = useOnboardingState();
  const completed = projects.filter((project) => project.sourceCount > 0);
  const unfinished = projects.filter((project) => project.sourceCount === 0);
  const [query, setQuery] = useState("");
  const keyword = query.trim().toLocaleLowerCase();
  const matches = (project: LocalProjectListItem) =>
    project.title.toLocaleLowerCase().includes(keyword);
  const visible = completed.filter(matches);
  const visibleUnfinished = unfinished.filter(matches);
  const step = firstRunStep(projects);
  // 引导只在宿主未记录完成、且本地没有已出章节的工程时呈现。
  const showGuide =
    desktop &&
    !appStateLoading &&
    onboardingCompleted === false &&
    step !== "done";
  const guideStep = step === "draft" ? "draft" : "new";
  // 引导指向的未完成工程：优先未导入的草案，其次已导入但还没有章节的工程。
  const guideDraftId =
    unfinished[0]?.id ??
    projects.find((project) => project.chapterCount === 0)?.id;
  // 出现章节即判定引导完成：宿主记录后不再自动呈现。
  const guideDone = step === "done" && onboardingCompleted === false;

  useEffect(() => {
    if (guideDone) void completeOnboarding();
  }, [guideDone, completeOnboarding]);

  return (
    <PageShell
      active="projects"
      title={t({ comment: "工程列表标题", message: "工程" })}
      description={
        desktop ? t`继续本地工程或导入小说章节。` : t`浏览器仅提供示例预览。`
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-5">
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            <Trans>正在读取本地工程…</Trans>
          </p>
        ) : null}
        {loadError ? (
          <p role="alert" className="text-sm text-destructive">
            <Trans>无法读取恢复草案，原记录已保留。</Trans>
          </p>
        ) : null}

        {showGuide ? (
          <FirstRunGuide
            step={guideStep}
            draftId={guideDraftId}
            onSkip={() => void completeOnboarding()}
          />
        ) : null}

        {!desktop ? (
          // 浏览器模式整页只有引导：示例与快速上手入口已包含在引导内，
          // 不再重复渲染底部示例区块和首次使用链接。
          <div className="flex min-h-[60vh] items-center justify-center">
            <BrowserPreviewGuide
              summary={
                <Trans>
                  工程导入、分章诊断与章节制作需要读取本机文件和模型，请在桌面应用中使用。
                </Trans>
              }
            />
          </div>
        ) : (
          <>
            {completed.length > searchThreshold ? (
              <SearchInput
                className="w-full max-w-xs"
                value={query}
                onValueChange={setQuery}
                aria-label={t({
                  comment: "按工程名称筛选列表",
                  message: "搜索工程",
                })}
                placeholder={t({ message: "搜索工程…" })}
              />
            ) : null}
            {/* 新建入口常驻网格第一格；工程少时它就是引导，多时与卡片同层可达。 */}
            <section
              aria-label={t({
                comment: "已保存工程列表",
                message: "工程",
              })}
              className="grid project-card-columns gap-4"
            >
              <Link
                to="/new"
                className={cn(
                  "flex min-h-20 items-center gap-3 rounded-surface border border-dashed border-border bg-card p-4 transition-colors outline-none hover:border-ring/50",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-item bg-muted text-muted-foreground"
                >
                  <PlusIcon className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    <Trans comment="新建工程并导入小说">新建工程</Trans>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    <Trans comment="新建卡说明文字">导入 TXT 小说</Trans>
                  </span>
                </span>
              </Link>
              {visibleUnfinished.map((project) => (
                <Link
                  key={project.id}
                  to="/new"
                  search={{ draft: project.id }}
                  className={cn(
                    "flex min-h-20 items-center gap-3 rounded-surface border border-border bg-card p-4 transition-colors outline-none hover:border-ring/50",
                    "focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <ProjectCardContent
                    project={project}
                    hint={
                      <>
                        <Trans comment="重新打开未另存的导入草案">
                          继续导入
                        </Trans>
                        <ArrowRightIcon className="ml-1 inline size-3.5" />
                      </>
                    }
                  />
                </Link>
              ))}
              {visible.map((project) => (
                <Link
                  key={project.id}
                  to="/project/$id"
                  params={{ id: project.id }}
                  className={cn(
                    "flex min-h-20 items-center gap-3 rounded-surface border border-border bg-card p-4 transition-colors outline-none hover:border-ring/50",
                    "focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <ProjectCardContent
                    project={project}
                    hint={
                      <Plural
                        value={project.chapterCount}
                        other="# 章"
                        comment="工程中的章节数量"
                      />
                    }
                  />
                </Link>
              ))}
            </section>
            {completed.length > searchThreshold &&
            keyword &&
            !visible.length &&
            !visibleUnfinished.length ? (
              <AppState
                kind="search"
                compact
                align="start"
                title={<Trans>没有匹配的工程</Trans>}
                actions={
                  <Button variant="outline" onClick={() => setQuery("")}>
                    <Trans comment="清除工程搜索条件">清除搜索</Trans>
                  </Button>
                }
              />
            ) : null}
            {!loading && !loadError && projects.length === 0 && !showGuide ? (
              // 新建入口已在网格第一格，空态只补充说明，不重复给同一个动作。
              <AppState
                icon={BookOpenIcon}
                align="start"
                title={<Trans>还没有工程</Trans>}
                description={
                  <>
                    <Trans>
                      导入 TXT 后自动分章并保存在本机，下次打开直接继续制作。
                    </Trans>
                    <ProjectFlowHint />
                  </>
                }
                className="min-h-0 py-8"
                actions={
                  draft.title || draft.description ? (
                    // 恢复草稿是独立入口：网格里的新建卡不会带出未提交的标题。
                    <Link to="/new" className={buttonVariants()}>
                      <Trans comment="继续尚未完成的章节导入">
                        继续导入草稿
                      </Trans>
                      <ArrowRightIcon data-icon="inline-end" />
                    </Link>
                  ) : null
                }
              />
            ) : null}
          </>
        )}
      </div>
    </PageShell>
  );
}
export const Route = createFileRoute("/")({ component: HomePage });
