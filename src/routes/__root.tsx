import { createRootRoute, Outlet } from "@tanstack/react-router";

// 根布局：全局结构（导航、全局面板、Toast 等）在此扩展；当前仅渲染子路由。
export const Route = createRootRoute({
  component: () => <Outlet />,
});
