import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { AppErrorBoundary } from "./components/app-error-boundary";
import { RouteFailure, RoutePending } from "./components/route-states";
import { setupFrontendLogging } from "./lib/frontend-log";
import { defaultLocale } from "./lib/i18n";
import { messages as sourceMessages } from "./locales/zh/messages.po";
import { routeTree } from "./routeTree.gen";
import "./index.css";

// Ship a source-language catalog with the shell so startup never waits on a locale request.
i18n.load(defaultLocale, sourceMessages);
if (!i18n.locale) {
  i18n.activate(defaultLocale);
}
// 脚本错误与未处理 Promise 拒绝转发宿主日志；浏览器预览下静默。
setupFrontendLogging();
const router = createRouter({
  routeTree,
  defaultErrorComponent: RouteFailure,
  defaultPendingComponent: RoutePending,
  defaultPendingMs: 250,
  defaultPendingMinMs: 150,
});

// 注册路由实例，让 useNavigate/Link 等获得完整类型推导
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function Root() {
  return (
    <I18nProvider i18n={i18n}>
      <AppErrorBoundary>
        <RouterProvider router={router} />
      </AppErrorBoundary>
    </I18nProvider>
  );
}

const reactRoot =
  import.meta.hot?.data.reactRoot ??
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
if (import.meta.hot) import.meta.hot.data.reactRoot = reactRoot;

reactRoot.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
