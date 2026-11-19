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
  ChevronDownIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
// 设置入口固定在最左侧栏底部（app-header-actions 的 RailFooter）；模型中心在首页侧栏顶部导航区。
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { LibrarySidebar } from "@/components/library-sidebar";
import { ChapterPlaybackBar } from "@/components/projects/chapter-playback-bar";
import { useChapterPlayback } from "@/components/projects/chapter-playback-provider";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [notices, setNotices] = useState<HTMLDivElement | null>(null);
  const window = useDesktopWindow();
  const location = useLocation();
  const navigate = useNavigate();
  const { projects } = useLocalProjects();
  const { player, inlineControls } = useChapterPlayback();
  const showChapterBar =
    (!inlineControls || location.pathname === "/settings") &&
    (player.state.active ||
      player.state.failed ||
      player.state.gapIndex != null);
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
    setSwitcherOpen(false);
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
  const openedProjects = t({
    comment: "打开工程切换下拉框的按钮名称",
    message: "已打开的工程",
  });
  const sampleTitle = t({
    comment: "示例工程标签名称",
    message: "夜航灯 · 示例",
  });
  const currentTitle =
    currentId === "sample"
      ? sampleTitle
      : projects.find((project) => project.id === currentId)?.title;
  const projectSwitcher = (
    <Popover open={switcherOpen} onOpenChange={setSwitcherOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="max-w-48 min-w-0 gap-1.5"
            aria-label={openedProjects}
            title={currentTitle ?? openedProjects}
          />
        }
      >
        <BookOpenIcon className="shrink-0 text-muted-foreground" />
        <span className="truncate">{currentTitle ?? openedProjects}</span>
        <ChevronDownIcon className="shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={openedProjects}>
        <nav
          aria-label={t({
            comment: "一个标签对应一个小说制作工程",
            message: "已打开的工程",
          })}
          className="flex max-h-64 min-w-0 flex-col gap-1 overflow-y-auto"
        >
          {openIds.map((id) => {
            const project = projects.find((p) => p.id === id);
            const title =
              id === "sample" ? sampleTitle : (project?.title ?? id);
            return (
              <div
                key={id}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1 rounded-md px-1",
                  currentId === id && "bg-accent",
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
                    "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-xs outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
                    currentId === id ? "font-medium" : undefined,
                  )}
                  title={title}
                  onClick={() => setSwitcherOpen(false)}
                >
                  <BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{title}</span>
                </Link>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t({
                    comment: "仅关闭已打开的制作视图，保留本地工程",
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
        <Link
          to="/new"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "justify-start",
          )}
          onClick={() => setSwitcherOpen(false)}
        >
          <PlusIcon />
          <Trans comment="创建新的制作工程">新建工程</Trans>
        </Link>
      </PopoverContent>
    </Popover>
  );
  return (
    <WorkspaceChromeContext.Provider
      value={{ leading, notices, projectSwitcher }}
    >
      <div className="flex h-svh flex-col overflow-hidden bg-sidebar text-foreground">
        <header
          data-slot="desktop-bar"
          data-platform={window.platform}
          data-focused={window.focused}
          className={cn(
            "flex h-(--app-header-height) shrink-0 items-center gap-1 bg-sidebar pl-2 select-none",
            window.platform === "macos" && "pl-[84px]",
          )}
        >
          <div
            ref={setLeading}
            data-slot="workspace-leading-controls"
            className="peer h-full min-w-0 flex-1 empty:hidden"
          />
          {onSettings && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
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
          <div
            data-tauri-drag-region={window.desktop ? "" : undefined}
            className="h-full min-w-4 flex-1 peer-not-empty:hidden"
          />
          {window.platform === "windows" && !window.fullscreen && (
            <WindowControls
              maximized={window.maximized}
              perform={window.perform}
            />
          )}
        </header>
        <div
          ref={setNotices}
          data-slot="workspace-notices"
          className="max-h-[25svh] shrink-0 overflow-y-auto bg-card empty:hidden"
        />
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
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
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
            <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden workspace-surface">
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
