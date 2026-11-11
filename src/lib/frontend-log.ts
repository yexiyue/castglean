// 异常只上传固定类别；异常文本、URL 与堆栈可能包含正文或凭据。
export type FrontendCategory =
  | "script_error"
  | "unhandled_rejection"
  | "render_error";

function report(level: "error" | "warn", category: FrontendCategory) {
  void import("@/lib/bindings")
    .then(({ commands }) => commands.frontendLog(level, category, null))
    .catch(() => {
      // 浏览器预览或宿主不可用时不制造新的异常。
    });
}

export function frontendHandlers(
  send: (level: "error" | "warn", category: FrontendCategory) => void,
) {
  return {
    scriptError: () => send("error", "script_error"),
    unhandledRejection: () => send("warn", "unhandled_rejection"),
    renderError: () => send("error", "render_error"),
  };
}

const handlers = frontendHandlers(report);
let installed = false;
export function setupFrontendLogging(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("error", handlers.scriptError);
  window.addEventListener("unhandledrejection", handlers.unhandledRejection);
}

export function reportFrontendError(_error: unknown, _context: string): void {
  handlers.renderError();
}
