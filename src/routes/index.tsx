import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon, BookOpenIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { AppState } from "@/components/app-state";
import { BrowserPreviewGuide } from "@/components/browser-preview-guide";
import { PageShell } from "@/components/page-shell";
import { ProjectFileStatus } from "@/components/projects/project-file-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePreviewProjects } from "@/lib/preview-projects";
import { desktop } from "@/lib/project-files";

function HomePage() {
  const { t } = useLingui();
  const { projects, draft, loadError } = usePreviewProjects();
  const completed = projects.filter((project) => !!project.filename);
  const unfinished = projects.filter((project) => !project.filename);
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
        desktop ? t`打开工程或导入小说章节。` : t`浏览器仅提供示例预览。`
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
        {loadError ? (
          <p role="alert" className="text-destructive text-sm">
            <Trans>无法读取恢复草案，原记录已保留。</Trans>
          </p>
        ) : null}

        {!desktop ? (
          <BrowserPreviewGuide
            summary={
              <Trans>
                工程导入、分章诊断与章节制作需要读取本机文件和模型，请在桌面应用中使用。
              </Trans>
            }
          />
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
                  className="hover:bg-accent/60 flex items-center justify-between py-3 text-sm"
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
            <div className="relative w-full max-w-xs">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2 left-2.5 size-4" />
              <Input
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={t({
                  comment: "按工程名称筛选列表",
                  message: "搜索工程",
                })}
                placeholder={t({ message: "搜索工程…" })}
              />
            </div>
            {visible.length ? (
              <div className="border-border divide-border divide-y border-t">
                {visible.map((project) => (
                  <Link
                    key={project.id}
                    to="/project/$id"
                    params={{ id: project.id }}
                    className="hover:bg-accent/60 focus-visible:ring-ring flex items-center gap-4 px-2 py-4 outline-none focus-visible:ring-2"
                  >
                    <BookOpenIcon className="text-muted-foreground size-5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-medium">
                        {project.title}
                      </h2>
                      <p className="text-muted-foreground mt-1 truncate text-xs">
                        <Plural
                          value={project.chapters.length}
                          other="# 章"
                          comment="工程中的章节数量"
                        />
                        <span className="mx-2" aria-hidden="true">
                          /
                        </span>
                        <ProjectFileStatus project={project} />
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

        {desktop && completed.length === 0 && unfinished.length === 0 ? (
          <AppState
            icon={BookOpenIcon}
            align="start"
            title={<Trans>还没有工程</Trans>}
            description={
              <Trans>
                导入整本 TXT，应用会先按标题自动分章；也可以打开已有的
                .castglean 工程文件。
              </Trans>
            }
            className="min-h-0 py-8"
            actions={
              <Button nativeButton={false} render={<Link to="/new" />}>
                {draft.title || draft.chapters.length ? (
                  <Trans comment="继续尚未完成的章节导入">继续导入草稿</Trans>
                ) : (
                  <Trans comment="创建工程并选择章节文件">导入章节</Trans>
                )}
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            }
          />
        ) : null}

        {projects.length === 0 && (
          <p className="text-muted-foreground text-sm">
            <Link
              to="/start"
              className="text-primary underline-offset-4 hover:underline"
            >
              <Trans comment="进入首次使用指引">第一次使用？查看快速上手</Trans>
            </Link>
          </p>
        )}

        <section
          aria-label={t({
            comment: "与用户真实工程分开的演示入口",
            message: "示例工程",
          })}
          className="border-border flex flex-wrap items-center justify-between gap-4 border-t pt-6"
        >
          <div className="min-w-0">
            <h2 className="text-sm font-medium">
              <Trans comment="用于了解工作台的示例小说">示例工程</Trans>
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              <Trans>夜航灯：查看章节、角色与声音绑定。</Trans>
            </p>
          </div>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/project/$id" params={{ id: "sample" }} />}
          >
            <Trans comment="打开示例小说的工作台">打开示例</Trans>
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </section>
      </div>
    </PageShell>
  );
}
export const Route = createFileRoute("/")({ component: HomePage });
