import { createRootRoute, Outlet } from "@tanstack/react-router";
import { PreviewProjectsProvider } from "@/lib/preview-projects";
import { DesktopShell } from "@/components/desktop-shell";
import { DesktopSessionProvider } from "@/lib/desktop-session";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RouteNotFound } from "@/components/route-states";

// 桌面外壳跨路由保留；工程数据、工程标签和视图会话分别管理。
export const Route = createRootRoute({
  notFoundComponent: RouteNotFound,
  component: () => (
    <TooltipProvider>
      <PreviewProjectsProvider>
        <DesktopSessionProvider>
          <DesktopShell>
            <Outlet />
          </DesktopShell>
        </DesktopSessionProvider>
      </PreviewProjectsProvider>
    </TooltipProvider>
  ),
});
