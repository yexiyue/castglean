# Design

## 背景

shadcn AI Elements 的分层是三级：`@shadcn/react`（headless 原语， owns 状态/测量）→ `ui/` 组件（拷贝进项目、挂主题 token）→ 组合模式（业务组件）。本 change 只落到前两级 + 重写一个业务组合。

## 模块划分

```
@shadcn/react/message-scroller     headless：Provider/Viewport/Content/Item/Button
src/components/ui/message.tsx      Message/MessageContent/MessageFooter（通用，无 AI 语义）
src/components/ui/bubble.tsx       用户消息气泡（通用）
src/components/ui/message-scroller.tsx  滚动容器壳（通用，任何可滚动线程可复用）
src/components/markdown.tsx        MessageResponse 迁来：Streamdown+CJK/code+Typeset，全应用共享
src/components/ai-elements/*.tsx   业务组合：session-messages / session-input / model-picker / …
```

- `ui/` 不 import `ai`、`@ai-sdk/react`、`ai-elements`；AI 语义（role、tool parts）只出现在 `ai-elements/` 与消费方。
- `markdown.tsx` 放 `components/` 根部而非 `ui/`：它不是 primitive 而是带插件的渲染器（与 shadcn Chat 模式的 `@/components/markdown` 约定一致）。
- 删除 `ai-elements/message.tsx`，不保留 `Message(from)` 兼容导出：`from` 语义在调用方用 `align="end"` + Bubble 表达。

## ui 组件取舍

- `ui/message.tsx`：不引入 MessageAvatar/MessageHeader/MessageGroup（本应用无头像、无群聊），按需后续再加；保留 MessageFooter 供 scope chip 与操作行。
- `ui/bubble.tsx`：保留 variant 表（muted 供用户消息），BubbleContent 圆角改 `rounded-surface` 对齐项目 token；`max-w-[80%]` 保留。
- `ui/message-scroller.tsx`：`IconPlaceholder` 换 lucide 直引；Viewport 去掉本项目未有的 `scroll-fade`/`scrollbar-*` 工具类（index.css 已有统一滚动条样式）；`contain-content`/`content-visibility` 性能类保留。
- Message Scroller 原语 props（实证自 `node_modules/@shadcn/react/dist/message-scroller` 类型）：
  - Provider：`autoScroll`（跟随流式，读者上滚即退避）、`defaultScrollPosition`（`start|end|last-anchor`）。
  - Viewport：`preserveScrollOnPrepend`（默认开，分页不跳）。
  - Item：`messageId`（稳定 id，供定位）、`scrollAnchor`（新回合锚定）。
  - Button：`direction="end"`，惰性显示 = 自研"回到最新"的替代。
- 本项目消息均为历史分页 + 追加流式，无"新回合锚定"需求：不设 `scrollAnchor`，`defaultScrollPosition="end"`，`autoScroll` 开。

## session-messages 结构

```
MessageScrollerProvider(autoScroll, defaultScrollPosition="end")
└ MessageScroller
  └ MessageScrollerViewport(role="log" aria-label 保留焦点行为)
    └ MessageScrollerContent
      ├ [hasOlder] MessageScrollerItem(messageId="load-older") Button 更早的消息
      └ messages.map → MessageScrollerItem(messageId=message.id)
        └ Message(align= role 推导) → assistant: MessageContent(+scope chip) / user: Bubble(muted)
          └ parts: text→user 字面 <p> / assistant→<Markdown>；
            data-result→结果卡；dynamic-tool→Trace 现状不变
  └ MessageScrollerButton(direction=end) 回到最新
```

- 删除自研的 follow ref、ResizeObserver、previousHeight 补偿、showLatest 状态。
- biome-ignore（tabindex / arrayIndexKey）按新结构重新评估，能删则删。
- SSR 安全：原语仅 effect 内测量，`renderToStaticMarkup`（ai-components 测试）不受影响。

## context-usage

裸 div progressbar → `ui/progress`，aria 属性交给组件；数值/文案逻辑不动。

## 验证策略

- 自动化：`pnpm test:ai`（ai-components/context-usage 断言继续通过）、`pnpm test`、biome、tsc。
- 真实验证：桌面窗口跑真实会话——流式跟随、上滚停跟随、点"更早"不跳、点"回到最新"、亮暗主题、en 文案。

## 明确不做

- 不迁移 shadcn Context/Code Block/Tool 模式（无对应工作流）。
- 不动 `@ai-sdk/react` useChat 与传输层。
- 不做导出兼容层。
