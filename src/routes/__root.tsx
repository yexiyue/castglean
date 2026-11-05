import {
  createRootRoute,
  Outlet,
  retainSearchParams,
} from "@tanstack/react-router";
import { DesktopShell } from "@/components/desktop-shell";
import { RouteNotFound } from "@/components/route-states";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VoicePlayerProvider } from "@/components/voices/voice-player";
import { DesktopSessionProvider } from "@/lib/desktop-session";
import { PreviewProjectsProvider } from "@/lib/preview-projects";

// 桌面外壳跨路由保留；工程数据、工程标签和视图会话分别管理。
export const Route = createRootRoute({
  // ?settings=<分区> 是设置浮层的深链标记：浮层状态就是地址栏状态，
  // 所以在根路由声明它，并让导航时保留，浮层跨页面仍然可用。
  validateSearch: (search: Record<string, unknown>): { settings?: string } => ({
    settings: typeof search.settings === "string" ? search.settings : undefined,
  }),
  search: {
    middlewares: [retainSearchParams(["settings"])],
  },
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
