import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): { section?: string } => ({
    section: typeof search.section === "string" ? search.section : undefined,
  }),
  // 设置页面由 DesktopShell 常驻承载（见 data-slot="settings-page"）：
  // 表单草稿、凭据输入与待确认保存跨导航保留（原浮层 keepMounted 语义），
  // 路由只承担地址、深链（?section=）与顶栏返回。
  component: () => null,
});
