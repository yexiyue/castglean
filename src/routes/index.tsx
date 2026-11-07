import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon, BookOpenIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { AppState } from "@/components/app-state";
import { PageShell } from "@/components/page-shell";
import { LocalProjectStatus } from "@/components/projects/local-project-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        {loading ? (
          <p role="status">
            <Trans>正在读取本地工程…</Trans>
          </p>
        ) : null}
        {loadError ? (
          <p role="alert" className="text-destructive text-sm">
            <Trans>无法读取恢复草案，原记录已保留。</Trans>
          </p>
        ) : null}
        {unfinished.length ? (
          <section className="space-y-2">
            <h2 className="text-sm font-medium">
              <Trans>未完成导入</Trans>
            </h2>
            {unfinished.map((project) => (
              <Link
                key={project.id}
                to="/new"
                search={{ draft: project.id }}
                className="flex items-center justify-between border-b py-3 text-sm"
              >
                <span>{project.title}</span>
                <span>
                  <Trans comment="重新打开未另存的导入草案">继续导入</Trans>
                </span>
              </Link>
            ))}
          </section>
        ) : null}

        {completed.length > 0 ? (
          <>
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
            <div className="border-border divide-border divide-y border-y">
              {visible.map((project) => (
                <Link
                  key={project.id}
                  to="/project/$id"
                  params={{ id: project.id }}
                  className="hover:bg-muted/50 focus-visible:ring-ring flex items-center gap-4 px-2 py-4 outline-none focus-visible:ring-2"
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
            {visible.length === 0 && (
              <AppState
                kind="search"
                title={<Trans>没有匹配的工程</Trans>}
                actions={
                  <Button variant="outline" onClick={() => setQuery("")}>
                    <Trans comment="清除工程搜索条件">清除搜索</Trans>
                  </Button>
                }
              />
            )}
          </>
        ) : null}
        {desktop && !loading && !loadError && projects.length === 0 ? (
          <section className="border-border border-b pb-6">
            <AppState
              icon={BookOpenIcon}
              title={<Trans>还没有工程</Trans>}
              description={<Trans>从侧栏新建工程并导入 TXT 章节。</Trans>}
              className="min-h-0 items-start px-0 py-6 text-left [&_[data-slot=empty-header]]:max-w-xl [&_[data-slot=empty-header]]:items-start"
            />
            <Button nativeButton={false} render={<Link to="/new" />}>
              {draft.title || draft.description ? (
                <Trans comment="继续尚未完成的章节导入">继续导入草稿</Trans>
              ) : (
                <Trans comment="创建工程并选择章节文件">导入章节</Trans>
              )}
              <ArrowRightIcon />
            </Button>
          </section>
        ) : null}
        {!loading && !loadError && projects.length === 0 && (
          <Button
            variant="link"
            className="h-auto self-start p-0"
            nativeButton={false}
            render={<Link to="/start" />}
          >
            <Trans comment="进入首次使用指引">第一次使用？查看快速上手</Trans>
          </Button>
        )}
        <section
          aria-label={t({
            comment: "与用户真实工程分开的演示入口",
            message: "示例工程",
          })}
          className="border-border flex flex-wrap items-center justify-between gap-4 border-b py-4"
        >
          <div>
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
            <ArrowRightIcon />
          </Button>
        </section>
      </div>
    </PageShell>
  );
}
export const Route = createFileRoute("/")({ component: HomePage });
