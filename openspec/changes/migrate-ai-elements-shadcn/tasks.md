# Tasks

## 1. ui 组件落地

- [x] 1.1 新增 `src/components/ui/message.tsx`（Message/MessageContent/MessageFooter，Base UI 变体，`cn` 从 `@/lib/utils`）
- [x] 1.2 新增 `src/components/ui/bubble.tsx`（Bubble/BubbleContent，variant 表，圆角对齐 `rounded-surface`）
- [x] 1.3 新增 `src/components/ui/message-scroller.tsx`（Provider/Root/Viewport/Content/Item/Button，lucide 直引，去 scroll-fade/scrollbar-* 工具类）

## 2. markdown 渲染器迁移

- [x] 2.1 新增 `src/components/markdown.tsx`：从 `ai-elements/message.tsx` 迁移 MessageResponse（Streamdown+CJK/code+Typeset 映射，memo 逻辑不变）
- [x] 2.2 删除 `src/components/ai-elements/message.tsx`

## 3. 业务组合重写

- [x] 3.1 重写 `session-messages.tsx`：Message Scroller 结构（Provider autoScroll + defaultScrollPosition="end"、Viewport preserveScrollOnPrepend、Item messageId、"更早的消息"行、MessageScrollerButton 回到最新），消息行按 align/Bubble 重组，scope chip 与中断提示保留
- [x] 3.2 `context-usage.tsx`：裸 progressbar div 换 `ui/progress`
- [x] 3.3 核对消费方 `imported-workspace.tsx`、`chapter-diagnostics.tsx` 及其他引用点一次性切换，清理失效 import

## 4. 验证与收尾

- [x] 4.1 `pnpm test:ai`、`pnpm test`、biome、tsc 全绿；更新受影响断言
- [ ] 4.2 桌面真实会话验收：流式跟随、上滚停跟随、"更早"不跳、"回到最新"、亮暗主题、中英文
- [ ] 4.3 同步 README 状态与 `docs/desktop-studio/` 相关条目；归档 change
