import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { BookOpenIcon, HomeIcon, PlusIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ModelStatusChip,
  SettingsTrigger,
} from "@/components/app-header-actions";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WindowCloseGuard } from "@/components/window-close-guard";
import { WindowControls } from "@/components/window-controls";
import { WorkspaceChromeContext } from "@/components/workspace-chrome";
import { useDesktopWindow } from "@/hooks/use-desktop-window";
import { useDesktopSession } from "@/lib/desktop-session";
import { useLocalProjects } from "@/lib/local-projects";
import { cn } from "@/lib/utils";

export function DesktopShell({ children }: { children: ReactNode }) {
  const { t } = useLingui();
  const [leading, setLeading] = useState<HTMLDivElement | null>(null);
  const [trailing, setTrailing] = useState<HTMLDivElement | null>(null);
  const chrome = useMemo(() => ({ leading, trailing }), [leading, trailing]);
  const window = useDesktopWindow();
  const location = useLocation();
  const navigate = useNavigate();
  const { projects } = useLocalProjects();
  const { openIds, openTab, closeTab, workspace } = useDesktopSession();
  const currentId = location.pathname.startsWith("/project/")
    ? decodeURIComponent(location.pathname.slice(9))
    : location.pathname === "/new" && typeof location.search.draft === "string"
      ? location.search.draft
      : undefined;
  const known =
    currentId === "sample" || projects.some((p) => p.id === currentId);
  useEffect(() => {
    if (currentId && known) openTab(currentId);
  }, [currentId, known, openTab]);
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
    <WorkspaceChromeContext.Provider value={chrome}>
      <div className="bg-background text-foreground flex h-svh flex-col overflow-hidden">
        <header
          data-slot="desktop-bar"
          data-platform={window.platform}
          data-focused={window.focused}
          className={cn(
            "bg-sidebar border-border flex h-11 shrink-0 items-center border-b select-none",
            window.platform === "macos" && "pl-[78px]",
          )}
        >
          <div
            ref={setLeading}
            data-slot="workspace-leading-controls"
            className="contents"
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={location.pathname === "/" ? "selected" : "ghost"}
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
              return (
                <div
                  key={id}
                  className={cn(
                    "border-border rounded-surface flex h-8 w-48 shrink-0 items-center gap-1 border border-transparent px-1",
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
                    className={cn(
                      "focus-visible:ring-ring hover:bg-accent/60 rounded-item flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-xs outline-none focus-visible:ring-2",
                      currentId === id ? "font-medium" : undefined,
                    )}
                    title={title}
                  >
                    <BookOpenIcon className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="truncate">{title}</span>
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
          <div
            data-tauri-drag-region={window.desktop ? "" : undefined}
            className="h-full min-w-8 flex-1"
          />
          <div className="flex shrink-0 items-center gap-1 pr-2">
            <ModelStatusChip />
            <SettingsTrigger />
          </div>
          <div
            ref={setTrailing}
            data-slot="workspace-trailing-controls"
            className="flex shrink-0 items-center gap-1 pr-2 empty:hidden"
          />
          {window.platform === "windows" && !window.fullscreen && (
            <WindowControls
              maximized={window.maximized}
              perform={window.perform}
            />
          )}
        </header>
        {window.failed && (
          <div
            role="alert"
            className="text-destructive bg-background px-4 py-1 text-xs"
          >
            <Trans>无法完成窗口操作。请取消后重试。</Trans>
          </div>
        )}
        <WindowCloseGuard />
        <div
          style={{ paddingBottom: "var(--voice-player-inset, 0px)" }}
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {children}
        </div>
        <SettingsDialog />
      </div>
    </WorkspaceChromeContext.Provider>
  );
}
