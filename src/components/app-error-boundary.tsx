// 顶层渲染异常边界：记录进宿主日志并给用户一个可恢复的界面。
import { useLingui } from "@lingui/react/macro";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportFrontendError } from "@/lib/frontend-log";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

function BoundaryFallback() {
  const { t } = useLingui();
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <p className="text-sm">
        {t({
          comment: "顶层渲染崩溃时的兜底文案",
          message: "界面出现错误，已记录到诊断日志。",
        })}
      </p>
      <button
        type="button"
        className="text-primary text-sm underline underline-offset-4"
        onClick={() => window.location.reload()}
      >
        {t({ comment: "顶层渲染崩溃后的重新加载入口", message: "重新加载" })}
      </button>
    </div>
  );
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportFrontendError(error, info.componentStack?.trim() ?? "render");
  }

  render() {
    return this.state.failed ? <BoundaryFallback /> : this.props.children;
  }
}
