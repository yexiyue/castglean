# Tasks

## 1. 集合页状态锚定

- [x] 1.1 `src/components/app-state.tsx`：新增「锚定」形态（内容高度自适应、不撑满剩余高度），保留整页居中形态不变。
- [x] 1.2 `src/components/voices/voice-library.tsx`：预置音色的加载态、错误态、搜索无结果态、「没有可用的预置音色」改为锚定形态；搜索无结果态补图标，与模型中心一致。
- [x] 1.3 `src/components/models/model-center.tsx`：加载态、搜索无结果态、「本构建没有编译进任何模型」改为锚定形态。
- [x] 1.4 `src/components/voices/my-voice-library.tsx`：搜索无结果态改为锚定形态（空库形态已在上一变更处理）。
- [x] 1.5 `src/components/voices/design-resources.tsx`：设计引擎列表的「没有匹配的模型」改为锚定形态，与模型中心一致。

## 2. 路由级状态保留应用外壳

- [x] 2.1 `src/components/route-states.tsx`：页面未找到、路由加载中、路由加载失败三个状态补应用级导航栏，形态与其他页面一致，仍保持整页居中。

## 3. 候选面板空态

- [x] 3.1 `src/components/voices/voice-studio-page.tsx`：候选为空时给出图标 + 标题 + 说明 + 下一步，替换原来的单行说明文字。

## 4. 规则与文档

- [x] 4.1 同步 `README.md`、`docs/desktop-studio/interaction-design.md`、`docs/ui-ux-audit/README.md`，新增知识库决策记录并更新索引。
- [x] 4.2 重新 extract Lingui 目录，清理不再使用的文案。

## 5. 验收

- [x] 5.1 `pnpm test`、`pnpm build`、`pnpm lint` 与目标 e2e 通过。
- [x] 5.2 真实窗口验收（macOS）：集合页三种状态、404、创建音色候选面板在 1024×680 与常规宽度、亮暗、中英文下的形态一致。证据与未覆盖边界见 `validation.md`（真实窗口为浅色中文，亮暗与中英组合由合成宿主 e2e 遍历覆盖）。
