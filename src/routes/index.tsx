import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon, BookOpenIcon } from "lucide-react";
import { useState } from "react";
import { AppState } from "@/components/app-state";
import { BrowserPreviewGuide } from "@/components/browser-preview-guide";
import { PageShell } from "@/components/page-shell";
import { LocalProjectStatus } from "@/components/projects/local-project-status";
import { Button, buttonVariants } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { desktop, useLocalProjects } from "@/lib/local-projects";

function HomePage() {
  const { t } = useLingui();
  const { projects, draft, loadError, loading } = useLocalProjects();
  const completed = projects.filter((project) => project.sourceCount > 0);
  const unfinished = projects.filter((project) => project.sourceCount === 0);
  const [query, setQuery] = useState("");
  const visible = completed.filter((project) =>
    project.title
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <PageShell
      active="projects"
      title={t({ comment: "工程列表标题", message: "最近工程" })}
      description={
        desktop ? t`继续本地工程或导入小说章节。` : t`浏览器仅提供示例预览。`
      }
      actions={
        desktop && projects.length > 0 ? (
          <Link to="/new" className={buttonVariants()}>
            <Trans>导入小说</Trans>
          </Link>
        ) : undefined
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-5">
        {loading ? (
          <p role="status" className="text-muted-foreground text-sm">
            <Trans>正在读取本地工程…</Trans>
          </p>
        ) : null}
        {loadError ? (
          <p role="alert" className="text-destructive text-sm">
            <Trans>无法读取恢复草案，原记录已保留。</Trans>
          </p>
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
        ) : unfinished.length ? (
          <section
            aria-label={t({ message: "未完成导入" })}
            className="flex flex-col gap-1"
          >
            <h2 className="text-sm font-medium">
              <Trans>未完成导入</Trans>
            </h2>
            <div className="border-border divide-border divide-y border-t">
              {unfinished.map((project) => (
                <Link
                  key={project.id}
                  to="/new"
                  search={{ draft: project.id }}
                  className="hover:bg-accent/60 focus-visible:ring-ring rounded-item flex items-center justify-between p-3 text-sm outline-none focus-visible:ring-2"
                >
                  <span className="truncate">{project.title}</span>
                  <span className="text-muted-foreground flex shrink-0 items-center gap-1">
                    <Trans comment="重新打开未另存的导入草案">继续导入</Trans>
                    <ArrowRightIcon className="size-3.5" />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {desktop && completed.length > 0 ? (
          <section
            aria-label={t({ comment: "已保存工程列表", message: "工程" })}
            className="flex flex-col gap-3"
          >
            <SearchInput
              className="w-full max-w-sm"
              value={query}
              onValueChange={setQuery}
              aria-label={t({
                comment: "按工程名称筛选列表",
                message: "搜索工程",
              })}
              placeholder={t({ message: "搜索工程…" })}
            />
            {visible.length ? (
              <div className="border-border divide-border divide-y border-t">
                {visible.map((project) => (
                  <Link
                    key={project.id}
                    to="/project/$id"
                    params={{ id: project.id }}
                    className="hover:bg-accent/60 focus-visible:ring-ring rounded-item flex items-center gap-4 p-3 outline-none focus-visible:ring-2"
                  >
                    <BookOpenIcon className="text-muted-foreground size-5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-medium">
                        {project.title}
                      </h2>
                      <p className="text-muted-foreground mt-1 truncate text-xs">
                        <Plural
                          value={project.chapterCount}
                          other="# 章"
                          comment="工程中的章节数量"
                        />
                        <span className="mx-2" aria-hidden="true">
                          /
                        </span>
                        <LocalProjectStatus />
                      </p>
                    </div>
                    <ArrowRightIcon className="text-muted-foreground size-4 shrink-0" />
                  </Link>
                ))}
              </div>
            ) : (
              <AppState
                kind="search"
                compact
                align="start"
                className="border-border rounded-none border-t px-0"
                title={<Trans>没有匹配的工程</Trans>}
                actions={
                  <Button variant="outline" onClick={() => setQuery("")}>
                    <Trans comment="清除工程搜索条件">清除搜索</Trans>
                  </Button>
                }
              />
            )}
          </section>
        ) : null}

        {desktop && !loading && !loadError && projects.length === 0 ? (
          <AppState
            icon={BookOpenIcon}
            align="start"
            title={<Trans>还没有工程</Trans>}
            description={
              <Trans>
                导入 TXT 后自动分章并保存在本机，下次直接从最近工程继续。
              </Trans>
            }
            className="min-h-0 py-8"
            actions={
              <Link to="/new" className={buttonVariants()}>
                {draft.title || draft.description ? (
                  <Trans comment="继续尚未完成的章节导入">继续导入草稿</Trans>
                ) : (
                  <Trans comment="创建工程并选择章节文件">导入章节</Trans>
                )}
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            }
          />
        ) : null}

        {/* 空状态保持单一导入入口（spec 场景）；快速上手入口在侧栏底部常驻。 */}

        {desktop ? (
          <section
            aria-label={t({
              comment: "与用户真实工程分开的演示入口",
              message: "示例工程",
            })}
            className="border-border flex flex-wrap items-center justify-between gap-4 border-t pt-4"
          >
            <div className="min-w-0">
              <h2 className="text-sm font-medium">
                <Trans comment="用于了解工作台的示例小说">示例工程</Trans>
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                <Trans>夜航灯：以只读方式浏览章节工作台。</Trans>
              </p>
            </div>
            <Link
              to="/project/$id"
              params={{ id: "sample" }}
              className={buttonVariants({ variant: "outline" })}
            >
              <Trans comment="打开示例小说的工作台">打开示例</Trans>
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </section>
        ) : null}
      </div>
    </PageShell>
  );
}
export const Route = createFileRoute("/")({ component: HomePage });
