import { createRootRoute, Outlet } from "@tanstack/react-router";
import { DesktopShell } from "@/components/desktop-shell";
import { RouteNotFound } from "@/components/route-states";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VoicePlayerProvider } from "@/components/voices/voice-player";
import { DesktopSessionProvider } from "@/lib/desktop-session";
import { PreviewProjectsProvider } from "@/lib/preview-projects";

// 桌面外壳跨路由保留；工程数据、工程标签和视图会话分别管理。
export const Route = createRootRoute({
  notFoundComponent: RouteNotFound,
  component: () => (
    <TooltipProvider>
      <PreviewProjectsProvider>
        <DesktopSessionProvider>
          <VoicePlayerProvider>
            <DesktopShell>
              <Outlet />
            </DesktopShell>
          </VoicePlayerProvider>
        </DesktopSessionProvider>
      </PreviewProjectsProvider>
    </TooltipProvider>
  ),
});
