# 弹窗表单嵌套触发外层表单提交（React Portal 事件冒泡）

日期：2026-11-14 · 适用：React 19 + Base UI Portal（任何 React 版本同样成立）· 关联：`src/components/settings/llm-settings.tsx`

## 触发条件

一个含 `<form>` 的 Dialog（如手动添加模型弹窗）在 JSX 里位于另一个 `<form>`（连接编辑表单）内部。Portal 只改变 DOM 位置，**React 合成事件沿 React 组件树冒泡**，不沿 DOM 树。

## 现象

点击弹窗的提交按钮 → 弹窗表单 onSubmit 正常执行，**同时 submit 事件沿 React 树冒进外层 `<form>` 的 onSubmit**，外层表单被意外提交（连接被保存、表单关闭）。外层 save 与弹窗回调都不报错，极难归因；页面无重载、DOM 无 `form form` 嵌套（Portal 已把弹窗送到 body）。

## 处理方式

1. **把含表单的 Dialog 移出外层 `<form>` 的 JSX 子树**（用 Fragment 同级包裹），事件路径即断开。不要试图用 e.stopPropagation 在弹窗 onSubmit 里补救——react-hook-form 的 handleSubmit 内部 preventDefault 不阻断 React 冒泡。
2. **整卡可点进编辑**时不要给容器挂 role=button 的点击（ARIA 按钮的子内容是 presentational，内层按钮会被读屏扁平化；lint/a11y/useSemanticElements 也会拦截）。用**拉伸按钮**模式：卡片内主标题是真 `<button>`，`after:absolute after:inset-0` 把点击区铺满整卡，其余操作按钮所在子树加 `relative` 叠在遮罩之上——语义干净、无需 stopPropagation、键盘路径原生。

## 验证证据

h2 文本埋点日志（可读通道）：修复前 `edit-existing → dialogSubmit → save`，Dialog 移出后 `edit-existing → dialogSubmit`，外层表单保持打开。85/85 单测 + 13 个 settings/chapters e2e 通过（含弹窗提交不触发外层保存的回归断言）；拉伸按钮卡片经浏览器实测：兄弟按钮可点、背景点击进编辑、Enter/X 键盘路径可用。

## 未验证边界

多级弹窗嵌套（弹窗内再开弹窗）未测；非 submit 类事件（change/input）理论上同样沿 React 树冒泡，依赖受控组件隔离，未专门验证。
