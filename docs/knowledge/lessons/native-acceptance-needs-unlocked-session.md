# 原生窗口验收需要已解锁的会话

日期：2026-11-11；2026-11-15 补充「窗口被遮挡」的另一种表现。状态：已复现并定位，属环境约束，无代码修复。适用：macOS（arm64），Tauri 2 开发构建，WKWebView。

## 现象

以隔离标识启动开发版后，应用进程存活、WebView 的网络进程与 Vite 保持着 HMR 连接，Vite 也照常记录 `hmr update`，但页面里的脚本完全不执行：新加载的模块没有副作用，不发起任何请求，也不调用 IPC。同时截图得到空白（`could not create image from display`）。

## 原因

验收时屏幕处于锁定状态（`ioreg -n Root -d1 -a` 中 `CGSSessionScreenIsLocked` 为真，用户已闲置近两小时）。窗口不可见时 WebKit 暂停页面进程的脚本执行，网络进程不受影响，所以“连接还在、更新也在推”会被误读成页面正常。

## 影响

锁屏期间无法进行任何真实窗口验收，无论是桌面控制、截图，还是在页面内运行测试脚本。宿主进程不受影响：引擎、数据库与文件读写照常，可以继续做不经过 WebView 的宿主层验证。

## 处理

- 开始原生验收前先确认会话已解锁、显示器未休眠，再启动应用；不要先排查网络或模块加载。
- 判断页面是否真的在运行，看 WebView 页面进程有没有发出请求或 IPC，不看 HMR 日志。
- 用户不在时，改做显式的真实引擎测试（如 `real_kokoro_generates_a_multi_voice_chapter_in_order`），并在记录里把“宿主层已验证”和“窗口未验证”分开写。

## 未验证

只在一台 macOS 机器上观察到；显示器休眠但未锁屏、窗口被遮挡或最小化时是否同样暂停，没有分别验证。相关记录见[章节音频验收](../../desktop-studio/chapter-audio-validation.md)。

## 补充：窗口被遮挡时页面脚本仍执行，但动画时间线被冻结

2026-11-15 在同一台机器上遇到窗口被系统遮挡（未锁屏）的另一种表现：

- `tauri-mcp webview-execute-js` 正常执行，页面脚本可用；
- 但 `document.visibilityState` 为 `hidden`，`document.hidden` 为 `true`；
- CSS 退场动画停在 `playState: "running"`、`startTime: null`、`currentTime: 0`，时间线不推进；
- 因此依赖动画结束才卸载的浮层（Base UI 的 `keepMounted` 弹层）会一直留在 DOM 里：地址栏的 `?settings=` 已经清掉，`[role=dialog]` 却仍然可见，看起来像「设置关不掉」。

判断方法：`document.getAnimations()` 返回 `startTime: null` 且 `playState` 停在 `running`，说明是环境冻结而不是应用缺陷。用 `window.__TAURI__.window.getCurrentWindow().show()` 会被权限拒绝，无法靠脚本把窗口拉回前台。

处理：窗口不可见时不要用「点关闭后浮层还在」推断功能缺陷；先用 `document.visibilityState` 与 `getAnimations()` 排除环境因素，再看真实缺陷。界面验收尽量安排在窗口可见时进行，深色/英文等组合可用浏览器 fixture 覆盖。
