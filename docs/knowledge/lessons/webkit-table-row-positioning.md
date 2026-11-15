# 表格行的整行可点不能用「首格按钮 ::after 铺满整行」

日期：2026-11-15 · 适用：macOS 桌面 WebView（WKWebView）+ Tauri 2 · 关联：`src/components/ui/table.tsx`、`src/components/voices/voice-library-rows.tsx`

## 触发条件

用「拉伸按钮」模式实现表格整行可点：首格按钮加 `after:absolute after:inset-0`，并让 `<tr>` 承担 `position: relative` 作为覆盖层的定位上下文。

## 现象

Chromium（Playwright fixture）里一切正常；macOS 真实 WebView 里进入音色中心后，**点击界面任意位置都会弹出音色详情**。真实 WebView 中 `getComputedStyle(tr).position` 返回 `static`（类名 `relative` 在 `<tr>` 上），覆盖层因此找不到行内定位上下文，退回更外层的定位祖先，`elementFromPoint` 在页面远处也命中该覆盖层。

## 原因

WebKit 忽略表格行元素上的 `position: relative`（表格行不是可定位盒），覆盖层的包含块退到视口或更外层容器，于是铺满窗口。同一写法在 Chromium 生效，所以浏览器 fixture 的回归无法暴露该问题。

## 处理方式

1. 表格整行可点改为**行级 `onClick`**（`TableRow` 的 `interactive` 只保留 `cursor-pointer` 与 `data-interactive`），不再依赖行内定位。
2. 行级处理跳过行内控件：点击目标的 `closest("button, a, input, [role='checkbox']")` 命中时交回控件自身，勾选框不会误开详情。
3. 名称按钮保持为真按钮，键盘用户仍走原生焦点路径。
4. 回归保护：`tests/unit/voice-list-row-click.test.mjs` 断言表格源码不再出现行内拉伸覆盖层与 `<tr>` 上的 `relative`；`e2e/voices/voice-list-interaction.spec.mjs` 覆盖行点击开详情、勾选框只切换选择、行外区域无弹窗。

## 验证证据

真实 macOS 桌面 WebView（tauri-mcp，端口 9223）：修复前 `elementFromPoint(60, 400)` 命中被拉伸的按钮覆盖层；修复后同一坐标命中侧边栏，点标题与搜索框均无弹窗，点行内非按钮单元格仍打开对应音色详情。

## 未验证边界

Windows WebView2（Chromium）未实测；表格行的 `position: relative` 在其他 WebKit 场景（如 CSS 表格布局）是否被忽略未系统验证；卡片视图不受影响。
