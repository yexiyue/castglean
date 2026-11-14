# tauri-mcp 验证：连接前提与 html2canvas 截图伪影

日期：2026-11-14。适用：Windows + Tauri 2 + tauri-plugin-mcp-bridge 0.13.2 + tauri-mcp CLI。

## 连接前提：两个配置缺一不可

症状：`driver-session status` 返回 `connected: true`，窗口枚举（原生 API）正常，但 `webview-execute-js`、`read-logs`、截图等**全部** webview 侧命令 2s 超时。

根因是两处配置同时缺失（`src-tauri/tauri.conf.json` 与 `src-tauri/capabilities/default.json`，已补）：

1. `app.withGlobalTauri: true` — 插件的 `bridge.js` 靠 `window.__TAURI__` 工作，缺失时 `waitForTauri` 每 50ms 无限轮询，页面侧永不就绪。
2. capability 中的 `mcp-bridge:default` — 插件自带权限集（含 `allow-script-result` 等 13 项）。Windows 上 `execute-js` 走「eval + 页面内 `invoke('plugin:mcp-bridge|script_result')` 回传」路线，无授权时结果被 Tauri ACL 拒绝，表现同样是超时。

只补其一会误判为「修复无效」。判断依据：插件源码 `bridge.js` 的 `waitForTauri` 与 `execute_js.rs` 的 `eval_with_ipc_callback`（cargo registry 缓存内可读）。

## html2canvas 截图伪影

`tauri-mcp webview-screenshot` 走页面自绘（html2canvas / Screen Capture API），对 **input 占位文字**渲染失真（文字上半截被切、顶部出现残影）。曾误判为真实缺陷：DOM 测量（`scrollHeight == clientHeight`、无溢出）显示正常。用 Win32 `PrintWindow`（`PW_RENDERFULLCONTENT`，不抢焦点、不动层级）做系统级对照后确认渲染无缺陷。像素级视觉判断不能只信 html2canvas 通道；伪影特征是裁切/错位集中在输入框内部文字。

## 验证边界

桥接功能（execute-js/截图/日志）已在真实桌面验证；`manage-window` 只有 list/info/resize，无 focus 动作；后台置窗截图用 PowerShell `PrintWindow`。用户正在使用机器时不要用 `AppActivate` 抢焦点。
