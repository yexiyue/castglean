import { Trans, useLingui } from "@lingui/react/macro";
import {
  Link,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  HomeIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
// 模型状态与设置入口已移至最左侧栏底部（app-header-actions 的 RailFooter）。
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LibrarySidebar } from "@/components/library-sidebar";
import { ChapterPlaybackBar } from "@/components/projects/chapter-playback-bar";
import { useChapterPlayback } from "@/components/projects/chapter-playback-provider";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AuditionRecovery } from "@/components/voices/audition-recovery";
import { CandidateMutationRecovery } from "@/components/voices/candidate-mutation-recovery";
import { ReferenceRecovery } from "@/components/voices/reference-recovery";
import { StudioRecovery } from "@/components/voices/studio-recovery";
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
  const { player } = useChapterPlayback();
  const showChapterBar =
    player.state.active || player.state.failed || player.state.gapIndex != null;
  const {
    openIds,
    openTab,
    closeTab,
    canCloseTab,
    workspace,
    restoreSettingsFocus,
  } = useDesktopSession();
  const router = useRouter();
  // 设置是独立页面：顶栏返回可回进入前的页面；直开深链无历史时回首页。
  const onSettings = location.pathname === "/settings";
  const goBack = () => {
    if (router.history.canGoBack()) router.history.back();
    else void navigate({ to: "/" });
  };
  // 焦点归还：离开设置页时把焦点还给打开设置前的元素（对话框时代语义）。
  const wasOnSettings = useRef(false);
  useEffect(() => {
    const leavingSettings = wasOnSettings.current && !onSettings;
    wasOnSettings.current = onSettings;
    if (leavingSettings) return restoreSettingsFocus();
  }, [onSettings, restoreSettingsFocus]);
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
  async function close(id: string) {
    if (!(await canCloseTab(id))) return;
    if (player.state.target?.projectId === id) player.stop();
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
      <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
        <header
          data-slot="desktop-bar"
          data-platform={window.platform}
          data-focused={window.focused}
          className={cn(
            "flex h-11 shrink-0 items-center bg-sidebar select-none",
            window.platform === "macos" && "pl-[78px]",
          )}
        >
          <div
            ref={setLeading}
            data-slot="workspace-leading-controls"
            className="contents"
          />
          {onSettings && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="mx-1 shrink-0"
                    aria-label={t({
                      comment: "设置页面顶栏返回上一页",
                      message: "返回",
                    })}
                    onClick={goBack}
                  />
                }
              >
                <ArrowLeftIcon />
              </TooltipTrigger>
              <TooltipContent>
                <Trans comment="设置页面顶栏返回上一页">返回</Trans>
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  to="/"
                  className={cn(
                    buttonVariants({
                      variant: location.pathname === "/" ? "selected" : "ghost",
                      size: "icon-sm",
                    }),
                    "mx-2 shrink-0",
                  )}
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
                    "flex h-8 w-48 shrink-0 items-center gap-1 rounded-surface border border-border border-transparent px-1",
                    currentId === id && "border-border bg-card shadow-xs",
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
                      "flex min-w-0 flex-1 items-center gap-2 rounded-item px-2 py-1 text-xs outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
                      currentId === id ? "font-medium" : undefined,
                    )}
                    title={title}
                  >
                    <BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{title}</span>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t({
                      comment: "仅关闭标签，工程仍保留在当前会话列表",
                      message: `关闭工程标签：${title}`,
                    })}
                    onClick={() => void close(id)}
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
                <Link
                  to="/new"
                  className={cn(
                    buttonVariants({
                      variant:
                        location.pathname === "/new" ? "selected" : "ghost",
                      size: "icon-sm",
                    }),
                    "mx-2 shrink-0",
                  )}
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
            className="bg-background px-4 py-1 text-xs text-destructive"
          >
            <Trans>无法完成窗口操作。请取消后重试。</Trans>
          </div>
        )}
        <WindowCloseGuard />
        <AuditionRecovery />
        <CandidateMutationRecovery />
        <StudioRecovery />
        <ReferenceRecovery />
        <div
          style={{
            paddingBottom: showChapterBar
              ? 0
              : "var(--voice-player-inset, 0px)",
          }}
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <div
            className={
              onSettings ? "hidden" : "relative flex min-h-0 flex-1 flex-col"
            }
          >
            {children}
          </div>
          {/* 设置页面：路由驱动可见性，组件常驻会话以保留表单草稿、
              凭据输入与待确认保存（原浮层 keepMounted 语义）。 */}
          <div
            data-slot="settings-page"
            aria-hidden={!onSettings}
            className={onSettings ? "flex min-h-0 flex-1" : "hidden"}
          >
            {/* 侧栏是无状态 chrome，随路由挂载；面板保持常驻以保留草稿。 */}
            {onSettings && <LibrarySidebar />}
            <div className="my-2 mr-2 flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-surface bg-card">
              <SettingsPanel
                section={
                  typeof location.search.section === "string"
                    ? location.search.section
                    : "general"
                }
                onSectionChange={(section) => {
                  void navigate({
                    to: "/settings",
                    search: (previous) => ({ ...previous, section }),
                    replace: true,
                  });
                }}
              />
            </div>
          </div>
        </div>
        {showChapterBar && (
          <div style={{ marginBottom: "var(--voice-player-inset, 0px)" }}>
            <ChapterPlaybackBar />
          </div>
        )}
      </div>
    </WorkspaceChromeContext.Provider>
  );
}
