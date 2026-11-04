import { Trans, Plural, useLingui } from "@lingui/react/macro";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  BookOpenIcon,
  PlusIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react";
import { ProjectFileStatus } from "@/components/projects/project-file-controls";
import { usePreviewProjects } from "@/lib/preview-projects";
import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { AppState } from "@/components/app-state";
import { OpenProjectButton } from "@/components/projects/project-file-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

function HomePage() {
  const { t } = useLingui();
  const { projects: previews, draft } = usePreviewProjects();
  const recent = previews[0];
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const projects = [
    ...previews.map((project) => ({
      id: project.id,
      title: project.title,
      chapters: project.chapters.length,
      progress: 0,
      archived: false,
      subtitle:
        project.fileState?.filename ??
        t({
          comment: "新工程尚未保存时的提示",
          message: "保存工程后可再次打开",
        }),
      project,
      preview: true,
    })),
    {
      project: undefined,
      preview: false,
      id: "sample",
      title: "夜航灯",
      chapters: 4,
      progress: 38,
      archived: false,
      subtitle: t({ comment: "工程卡片中的最近打开时间", message: "刚刚打开" }),
    },
  ];
  const visible = projects.filter(
    (p) =>
      p.title.includes(query.trim()) &&
      (filter === "all" || (filter === "archived" ? p.archived : !p.archived)),
  );
  return (
    <PageShell
      active="projects"
      title={t({
        comment: "首页已保存与当前会话的工程列表",
        message: "最近工程",
      })}
      description={t({ message: "从一章开始，把故事做成想听的声音。" })}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-7">
        {recent ? (
          <section className="bg-card border-border flex flex-wrap items-center justify-between gap-6 rounded-xl border p-6">
            <div className="flex items-center gap-4">
              <div className="bg-secondary text-primary flex size-12 items-center justify-center rounded-xl">
                <BookOpenIcon className="size-6" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">
                  <Trans comment="首页中最近工程的快捷入口标题">继续制作</Trans>
                </span>
                <h2 className="font-semibold">{recent?.title ?? "夜航灯"}</h2>
                <p className="text-muted-foreground text-sm">
                  {recent ? (
                    <Plural
                      value={recent.chapters.length}
                      one="# 章 · 尚未分析"
                      other="# 章 · 尚未分析"
                      comment="最近预览工程的待制作章节数量"
                    />
                  ) : (
                    <Trans>第一章 · 3 项待检查</Trans>
                  )}
                </p>
              </div>
            </div>
            <Button
              nativeButton={false}
              render={
                <Link
                  to="/project/$id"
                  params={{ id: recent?.id ?? "sample" }}
                />
              }
            >
              <Trans comment="打开最近的示例制作工作台">进入工作台</Trans>
              <ArrowUpRightIcon data-icon="inline-end" />
            </Button>
          </section>
        ) : (
          <AppState
            icon={BookOpenIcon}
            title={<Trans>从第一个工程开始</Trans>}
            description={
              <Trans>
                导入小说章节开始制作，或打开已有的 .castglean 工程文件。
              </Trans>
            }
            className="bg-card border-border min-h-0 border py-8"
            actions={
              <>
                <Button nativeButton={false} render={<Link to="/new" />}>
                  <PlusIcon data-icon="inline-start" />
                  <Trans comment="首次进入应用时建立第一个小说制作工程">
                    新建工程
                  </Trans>
                </Button>
                <OpenProjectButton />
              </>
            }
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={filter} onValueChange={(v) => setFilter(String(v))}>
            <TabsList variant="line">
              <TabsTrigger value="all">
                <Trans comment="工程状态筛选，全部工程">全部</Trans>
              </TabsTrigger>
              <TabsTrigger value="active">
                <Trans comment="工程状态筛选，正在制作的工程">制作中</Trans>
              </TabsTrigger>
              <TabsTrigger value="archived">
                <Trans comment="工程状态筛选，已归档的工程">已归档</Trans>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex w-64 items-center gap-2">
            <SearchIcon className="text-muted-foreground size-4 shrink-0" />
            <Input
              aria-label={t({
                comment: "工程名搜索输入框",
                message: "搜索工程",
              })}
              placeholder={t({
                comment: "工程名搜索提示",
                message: "搜索工程…",
              })}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <div className="mb-5 flex items-center justify-between">
                  <div className="bg-secondary text-muted-foreground flex size-11 items-center justify-center rounded-lg">
                    <BookOpenIcon className="size-5" />
                  </div>
                  <Badge variant="outline">
                    {p.preview ? (
                      p.project ? (
                        <ProjectFileStatus project={p.project} />
                      ) : null
                    ) : (
                      <Trans comment="标记工程卡片为设计预览数据">
                        示例工程
                      </Trans>
                    )}
                  </Badge>
                </div>
                <CardTitle>{p.title}</CardTitle>
                <CardDescription>{p.subtitle}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="text-muted-foreground flex items-center justify-between text-xs">
                  <Plural
                    value={p.chapters}
                    one="# 章"
                    other="# 章"
                    comment="工程包含的章节总数"
                  />
                  {p.preview ? (
                    <Trans comment="导入预览工程还没有生成音频">待制作</Trans>
                  ) : (
                    <span>{p.progress}%</span>
                  )}
                </div>
                {p.preview ? (
                  <p className="text-muted-foreground text-xs">
                    <Trans>正文已就绪，尚未生成音频。</Trans>
                  </p>
                ) : (
                  <Progress value={p.progress} />
                )}
              </CardContent>
              <CardFooter className="justify-between">
                <Badge variant="secondary">
                  {p.preview
                    ? t({
                        comment: "已导入正文且等待开始制作的工程",
                        message: "正文就绪",
                      })
                    : p.archived
                      ? t({ comment: "工程状态，已归档", message: "已归档" })
                      : t({ comment: "工程状态，制作中", message: "制作中" })}
                </Badge>
                {p.id === "sample" || p.preview ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    nativeButton={false}
                    render={<Link to="/project/$id" params={{ id: p.id }} />}
                  >
                    <Trans comment="进入选中的工程">打开</Trans>
                    <ArrowUpRightIcon data-icon="inline-end" />
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" disabled>
                    <Trans comment="工程卡片仅用于布局预览">仅供预览</Trans>
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
        {visible.length === 0 ? (
          <AppState
            kind="search"
            title={
              query.trim() ? (
                <Trans>没有匹配的工程</Trans>
              ) : (
                <Trans>还没有归档工程</Trans>
              )
            }
            description={
              query.trim() ? (
                <Trans>换个名称搜索，或清除筛选查看全部工程。</Trans>
              ) : (
                <Trans>当前工程仍在制作中，可以返回全部工程继续。</Trans>
              )
            }
            actions={
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                <Trans comment="重置搜索关键词与分类筛选">清除搜索与筛选</Trans>
              </Button>
            }
          />
        ) : null}
        <section className="border-border flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
          <UploadIcon className="text-muted-foreground size-6" />
          <h2 className="text-sm font-medium">
            <Trans>把下一本故事带进来</Trans>
          </h2>
          <p className="text-muted-foreground text-sm">
            <Trans>批量选择 UTF-8 TXT，确认顺序后进入正文预览。</Trans>
          </p>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/new" />}
          >
            <PlusIcon data-icon="inline-start" />
            {draft.title || draft.chapters.length ? (
              <Trans comment="继续当前会话中的新建工程草稿">继续导入草稿</Trans>
            ) : (
              <Trans comment="打开新建工程并导入章节的向导">导入章节</Trans>
            )}
          </Button>
        </section>
      </div>
    </PageShell>
  );
}
export const Route = createFileRoute("/")({ component: HomePage });
