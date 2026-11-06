import { Link } from "@tanstack/react-router";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import {
  BookOpenIcon,
  FileTextIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PlayIcon,
  SettingsIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SparklesIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import type { Chapter, TextPage } from "@/lib/bindings";
import { readProjectText } from "@/lib/project-files";
import { AppSidebar } from "@/components/app-sidebar";
import {
  ProjectFileStatus,
  SaveProjectButton,
} from "@/components/projects/project-file-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDesktopSession, useWorkspaceState } from "@/lib/desktop-session";
import type { PreviewProject } from "@/lib/preview-projects";
import { cn } from "@/lib/utils";

export function ImportedWorkspace({ project }: { project: PreviewProject }) {
  const { t } = useLingui();
  const [contextOpen, setContextOpen] = useWorkspaceState(
    project.id,
    "contextOpen",
    true,
  );
  const [chapterId, setChapterId] = useWorkspaceState(
    project.id,
    "chapterId",
    project.chapters[0].id,
  );
  const [view, setView] = useWorkspaceState(project.id, "view", "characters");
  const { workspace, openSettings } = useDesktopSession();
  const [directoryPage, setDirectoryPage] = useState(0);
  const page = Math.min(
    directoryPage,
    Math.floor((project.chapters.length - 1) / 50),
  );
  const offset = page * 50;
  const source = useRef<HTMLElement>(null);
  const chapter =
    project.chapters.find((c) => c.id === chapterId) ?? project.chapters[0];
  useEffect(() => {
    if (source.current)
      source.current.scrollTop = Number(
        workspace(project.id)[`scroll:${chapter.id}`] ?? 0,
      );
  }, [project.id, chapter.id, workspace]);
  return (
    <SidebarProvider
      className="bg-background text-foreground h-full min-h-0 overflow-hidden"
      style={
        {
          "--sidebar-width": "4rem",
          "--sidebar-width-icon": "4rem",
        } as CSSProperties
      }
    >
      <AppSidebar projectId={project.id} />
      <SidebarInset className="min-w-0 flex-1">
        <Tabs
          value={view}
          onValueChange={(value) => setView(String(value))}
          className="min-h-0 flex-1 gap-0"
        >
          <header className="bg-card border-border flex h-(--app-header-height) shrink-0 items-center gap-3 border-b px-5">
            <h1 className="sr-only">{project.title}</h1>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link to="/new" search={{ draft: project.id }} />}
            >
              <Trans>检查分章</Trans>
            </Button>
            <div className="flex w-full min-w-0 items-center gap-3">
              <TabsList>
                <TabsTrigger value="characters">
                  <Trans comment="正文角色与归属视图">角色</Trans>
                </TabsTrigger>
                <TabsTrigger value="performance">
                  <Trans comment="正文朗读规划视图">演绎</Trans>
                </TabsTrigger>
                <TabsTrigger value="audio">
                  <Trans comment="正文音频候选视图">音频</Trans>
                </TabsTrigger>
              </TabsList>
              <div className="ml-auto">
                <SaveProjectButton project={project} />
              </div>
              <Button size="sm" disabled>
                <SparklesIcon data-icon="inline-start" />
                <Trans comment="整章音频生成，预览工程未接入合成">
                  生成本章
                </Trans>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="hidden lg:inline-flex"
                aria-expanded={contextOpen}
                aria-controls={`context-${project.id}`}
                aria-label={
                  contextOpen
                    ? t({
                        comment: "收起右侧上下文与归属检查区域",
                        message: "收起检查面板",
                      })
                    : t({
                        comment: "展开右侧上下文与归属检查区域",
                        message: "展开检查面板",
                      })
                }
                title={
                  contextOpen
                    ? t({ message: "收起检查面板" })
                    : t({ message: "展开检查面板" })
                }
                onClick={() => setContextOpen((open) => !open)}
              >
                {contextOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
              </Button>
            </div>
          </header>
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <aside className="border-border bg-sidebar hidden w-60 shrink-0 flex-col border-r md:flex">
              <div className="border-border flex h-16 flex-col justify-center gap-1 border-b px-4">
                <span className="text-muted-foreground text-xs">
                  <Trans comment="导入工程的章节列表标题">章节列表</Trans>
                </span>
                <p className="truncate text-sm font-medium">{project.title}</p>
              </div>
              <ol className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
                {project.chapters.slice(offset, offset + 50).map((c, index) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={cn(
                        "hover:bg-accent flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left transition-colors",
                        chapter.id === c.id && "bg-accent",
                      )}
                      aria-current={chapter.id === c.id}
                      onClick={() => setChapterId(c.id)}
                    >
                      <span className="text-muted-foreground mt-0.5 font-mono text-xs">
                        {String(offset + index + 1).padStart(2, "0")}
                      </span>
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="truncate text-sm font-medium">
                          {c.title}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          <Trans comment="刚导入的章节还没有模型分析">
                            尚未分析
                          </Trans>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {project.chapters.length > 50 ? (
                <div className="flex items-center justify-between gap-1 border-t p-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setDirectoryPage(page - 1)}
                  >
                    <Trans>上一页</Trans>
                  </Button>
                  <span className="text-muted-foreground text-xs">
                    {page + 1} / {Math.ceil(project.chapters.length / 50)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset + 50 >= project.chapters.length}
                    onClick={() => setDirectoryPage(page + 1)}
                  >
                    <Trans>下一页</Trans>
                  </Button>
                </div>
              ) : null}
              <div className="border-border border-t p-4">
                <Badge variant="outline">
                  <ProjectFileStatus project={project} />
                </Badge>
              </div>
            </aside>
            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="border-border flex h-12 shrink-0 items-center justify-between gap-3 border-b px-5">
                <h2 className="text-muted-foreground text-xs font-medium">
                  <Trans comment="只读正文阅读区标题">正文</Trans>
                </h2>
                <span className="text-muted-foreground text-xs">
                  <Plural
                    value={chapter.end - chapter.start}
                    one="# 字节"
                    other="# 字节"
                    comment="当前章节在原文快照中的 UTF-8 字节数"
                  />
                </span>
              </div>
              <article
                ref={source}
                onScroll={(event) => {
                  workspace(project.id)[`scroll:${chapter.id}`] =
                    event.currentTarget.scrollTop;
                }}
                key={chapter.id}
                aria-label={chapter.title}
                className="min-h-0 flex-1 overflow-y-auto px-8 py-6"
              >
                <p className="mx-auto max-w-3xl text-[15px] leading-8 wrap-break-word whitespace-pre-wrap">
                  <ChapterSource
                    key={chapter.id}
                    project={project}
                    chapter={chapter}
                  />
                </p>
              </article>
              <p className="text-muted-foreground border-border border-t px-5 py-2 text-xs">
                <span role="status">
                  {project.fileState ? (
                    <Trans>工程文件可从首页重新打开。原始 TXT 未被修改。</Trans>
                  ) : (
                    <Trans>请保存工程以便下次继续。原始 TXT 未被修改。</Trans>
                  )}
                </span>
              </p>
            </section>
            <aside
              id={`context-${project.id}`}
              className={cn(
                "bg-card border-border hidden w-80 shrink-0 flex-col border-l lg:flex",
                !contextOpen && "lg:hidden",
              )}
            >
              <div className="border-border flex h-12 items-center border-b px-4">
                <span className="text-muted-foreground text-xs">
                  <Trans comment="右侧上下文区域标题">上下文</Trans>
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <TabsContent value="characters">
                  <Card size="sm">
                    <CardHeader>
                      <CardTitle>
                        <Trans comment="刚导入的正文尚无角色分析">
                          尚未分析
                        </Trans>
                      </CardTitle>
                      <CardDescription>
                        <Trans>导入不会自动推断角色或台词归属。</Trans>
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-muted-foreground text-sm leading-7">
                        <Trans>
                          配置文本模型后，再分析角色并检查原文依据。
                        </Trans>
                      </p>
                    </CardContent>
                    <CardFooter>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openSettings("models")}
                      >
                        <SettingsIcon data-icon="inline-start" />
                        <Trans comment="设置类别，仅管理远程端点与凭据，不管理模型资源">
                          服务连接
                        </Trans>
                      </Button>
                    </CardFooter>
                  </Card>
                </TabsContent>
                <TabsContent value="performance">
                  <Card size="sm">
                    <CardHeader>
                      <CardTitle>
                        <Trans comment="导入工程尚无朗读计划">
                          尚无演绎建议
                        </Trans>
                      </CardTitle>
                      <CardDescription>
                        <Trans>段落意图与停顿规划将在分析后展示。</Trans>
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-muted-foreground text-sm leading-7">
                        <Trans>
                          单人旁白可以先选声，不要求先完成角色分析。
                        </Trans>
                      </p>
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="audio">
                  <Card size="sm">
                    <CardHeader>
                      <CardTitle>
                        <Trans comment="导入工程没有真实生成音频">
                          尚无音频
                        </Trans>
                      </CardTitle>
                      <CardDescription>
                        <Trans>导入正文不会自动生成或采用音频。</Trans>
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openSettings("models")}
                      >
                        <SettingsIcon data-icon="inline-start" />
                        <Trans comment="设置类别，仅管理远程端点与凭据，不管理模型资源">
                          服务连接
                        </Trans>
                      </Button>
                    </CardContent>
                  </Card>
                </TabsContent>
                <div className="text-muted-foreground mt-5 flex items-start gap-2 text-xs leading-6">
                  <FileTextIcon className="mt-1 size-4 shrink-0" />
                  <span className="break-all">
                    {
                      project.sources.find((s) => s.id === chapter.sourceId)
                        ?.filename
                    }
                  </span>
                </div>
                {project.description ? (
                  <p className="text-muted-foreground mt-3 text-xs leading-6">
                    {project.description}
                  </p>
                ) : null}
              </div>
            </aside>
          </div>
        </Tabs>
        <footer className="bg-card border-border flex min-h-20 shrink-0 items-center justify-between gap-4 border-t px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <BookOpenIcon className="text-muted-foreground size-5 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{chapter.title}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                <Trans>当前章节暂无音频</Trans>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled
              aria-label={t({ comment: "播放器上一章按钮", message: "上一章" })}
            >
              <SkipBackIcon />
            </Button>
            <Button
              size="icon-sm"
              disabled
              aria-label={t({
                comment: "播放器播放按钮，尚无音频",
                message: "播放",
              })}
            >
              <PlayIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled
              aria-label={t({ comment: "播放器下一章按钮", message: "下一章" })}
            >
              <SkipForwardIcon />
            </Button>
          </div>
          <span className="text-muted-foreground hidden text-xs sm:block">
            <Plural
              value={project.chapters.length}
              one="# 章"
              other="# 章"
              comment="预览工程章节总数"
            />
          </span>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ChapterSource({
  project,
  chapter,
}: {
  project: PreviewProject;
  chapter: Chapter;
}) {
  const [page, setPage] = useState<TextPage | null>(null);
  const [line, setLine] = useState(chapter.heading ?? 0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void readProjectText(project, chapter.sourceId, line)
      .then((value) => {
        if (active) setPage(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [project, chapter.sourceId, line]);
  if (failed)
    return (
      <span role="alert">
        <Trans>无法读取正文，请重新打开工程或缩小读取范围。</Trans>
      </span>
    );
  const visible =
    page?.lines.filter(
      (item) => item.start >= chapter.start && item.start < chapter.end,
    ) ?? [];
  return (
    <>
      <span>{visible.map((item) => item.text).join("")}</span>
      <span className="mt-4 flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={line <= (chapter.heading ?? 0)}
          onClick={() => setLine((v) => Math.max(chapter.heading ?? 0, v - 30))}
        >
          <Trans comment="章节正文上一段">上一段</Trans>
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={
            page?.nextLine == null ||
            (page.lines[page.lines.length - 1]?.end ?? chapter.end) >=
              chapter.end
          }
          onClick={() => setLine(page?.nextLine ?? line)}
        >
          <Trans comment="章节正文下一段">下一段</Trans>
        </Button>
      </span>
    </>
  );
}
