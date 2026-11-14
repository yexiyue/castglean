import { Trans } from "@lingui/react/macro";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AppState } from "@/components/app-state";
import { Button, buttonVariants } from "@/components/ui/button";

export function RouteNotFound() {
  return (
    <main className="flex size-full min-h-0 flex-col overflow-y-auto p-4 sm:p-8">
      <AppState
        className="my-auto flex-none"
        title={<Trans>这个页面不存在</Trans>}
        description={
          <Trans>地址可能已变化。返回工程首页，继续打开最近的工程。</Trans>
        }
        actions={
          <Link to="/" className={buttonVariants()}>
            <Trans comment="找不到页面时返回应用工程列表">返回工程首页</Trans>
          </Link>
        }
      />
    </main>
  );
}
export function RoutePending() {
  return (
    <main className="flex size-full min-h-0 flex-col overflow-y-auto p-4 sm:p-8">
      <AppState
        className="my-auto flex-none"
        kind="loading"
        title={<Trans>正在加载页面…</Trans>}
        description={<Trans>正在准备工作区，请稍候。</Trans>}
      />
    </main>
  );
}
export function RouteFailure({ reset }: ErrorComponentProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    try {
      await router.invalidate();
      reset();
    } catch {
      /* Keep recovery controls available if retry also fails. */
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex size-full min-h-0 flex-col overflow-y-auto p-4 sm:p-8">
      <AppState
        className="my-auto flex-none"
        kind="error"
        title={<Trans>页面未能加载</Trans>}
        description={
          <Trans>
            请重试，或返回工程首页重新打开。已保存的工程文件不会被修改。
          </Trans>
        }
        actions={
          <>
            <Button disabled={busy} onClick={() => void retry()}>
              {busy ? (
                <Trans comment="页面失败后的重试进行中">正在重试…</Trans>
              ) : (
                <Trans comment="重新加载当前失败的路由">重试加载</Trans>
              )}
            </Button>
            <Link to="/" className={buttonVariants({ variant: "outline" })}>
              <Trans comment="找不到页面时返回应用工程列表">返回工程首页</Trans>
            </Link>
          </>
        }
      />
    </main>
  );
}
