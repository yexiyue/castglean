import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  HomeIcon,
  PlusIcon,
  XIcon,
  BookOpenIcon,
  CircleIcon,
} from "lucide-react";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { usePreviewProjects } from "@/lib/preview-projects";
import { useDesktopSession } from "@/lib/desktop-session";
import { cn } from "@/lib/utils";

export function DesktopShell({ children }: { children: ReactNode }) {
  const { t } = useLingui();
  const location = useLocation();
  const navigate = useNavigate();
  const { projects } = usePreviewProjects();
  const { openIds, openTab, closeTab, rememberLocation, workspace } =
    useDesktopSession();
  const currentId = location.pathname.startsWith("/project/")
    ? decodeURIComponent(location.pathname.slice(9))
    : undefined;
  const known =
    currentId === "sample" || projects.some((p) => p.id === currentId);
  useEffect(() => {
    if (currentId && known) openTab(currentId);
  }, [currentId, known, openTab]);
  useEffect(() => {
    if (!location.pathname.startsWith("/settings"))
      rememberLocation(location.href);
  }, [location.pathname, location.href, rememberLocation]);
  function close(id: string) {
    closeTab(id);
    if (currentId !== id) return;
    const index = openIds.indexOf(id);
    const next = openIds[index + 1] ?? openIds[index - 1];
    if (next)
      void navigate({
        to: "/project/$id",
        params: { id: next },
        search: {
          section: workspace(next).section as
            | "chapters"
            | "characters"
            | "results"
            | undefined,
        },
      });
    else void navigate({ to: "/" });
  }
  return (
    <div className="bg-background text-foreground flex h-svh flex-col overflow-hidden">
      <header
        data-slot="desktop-bar"
        className="bg-sidebar border-border flex h-11 shrink-0 items-center border-b"
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={location.pathname === "/" ? "secondary" : "ghost"}
                size="icon-sm"
                className="mx-3 shrink-0"
                nativeButton={false}
                render={<Link to="/" />}
                aria-label={t({
                  comment: "桌面顶部返回独立工程首页",
                  message: "工程首页",
                })}
              />
            }
          >
            <HomeIcon />
          </TooltipTrigger>
          <TooltipContent>
            <Trans comment="桌面顶部返回独立工程首页">工程首页</Trans>
          </TooltipContent>
        </Tooltip>
        <nav
          aria-label={t({
            comment: "一个标签对应一个小说制作工程",
            message: "已打开的工程",
          })}
          className="flex h-full min-w-0 items-center gap-1 overflow-x-auto"
        >
          {openIds.map((id) => {
            const project = projects.find((p) => p.id === id);
            const title =
              id === "sample"
                ? t({ comment: "示例工程标签名称", message: "夜航灯 · 示例" })
                : (project?.title ?? id);
            const unsaved = !!project && !project.fileState;
            return (
              <div
                key={id}
                className={cn(
                  "border-border flex h-8 w-48 shrink-0 items-center gap-1 rounded-md border border-transparent px-1",
                  currentId === id && "bg-card border-border shadow-xs",
                )}
              >
                <Link
                  to="/project/$id"
                  params={{ id }}
                  search={{
                    section: workspace(id).section as
                      | "chapters"
                      | "characters"
                      | "results"
                      | undefined,
                  }}
                  aria-current={currentId === id ? "page" : undefined}
                  className="focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-xs outline-none focus-visible:ring-2"
                  title={title}
                >
                  <BookOpenIcon className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="truncate">{title}</span>
                  {unsaved && (
                    <CircleIcon
                      className="text-muted-foreground size-1.5 shrink-0 fill-current"
                      aria-label={t({
                        comment: "工程标签尚未保存的标记",
                        message: "未保存",
                      })}
                    />
                  )}
                </Link>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t({
                    comment: "仅关闭标签，工程仍保留在当前会话列表",
                    message: `关闭工程标签：${title}`,
                  })}
                  onClick={() => close(id)}
                >
                  <XIcon />
                </Button>
              </div>
            );
          })}
        </nav>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="mx-2 shrink-0"
                nativeButton={false}
                render={<Link to="/new" />}
                aria-label={t({
                  comment: "从顶部加号新建另一本小说工程",
                  message: "新建工程",
                })}
              />
            }
          >
            <PlusIcon />
          </TooltipTrigger>
          <TooltipContent>
            <Trans comment="创建新的制作工程">新建工程</Trans>
          </TooltipContent>
        </Tooltip>
        <span className="text-muted-foreground ml-auto hidden shrink-0 px-5 text-xs sm:block">
          CastGlean
        </span>
      </header>
      <div
        className={cn(
          "relative flex min-h-0 flex-1 flex-col",
          location.pathname === "/design-system"
            ? "overflow-y-auto"
            : "overflow-hidden",
        )}
      >
        {children}
      </div>
    </div>
  );
}
