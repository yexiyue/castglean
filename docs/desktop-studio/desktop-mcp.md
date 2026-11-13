# 桌面 MCP 调试

使用 `pnpm desktop:dev` 启动真实 CastGlean 开发窗口。命令合并 `src-tauri/tauri.mcp.conf.json`，在该开发运行启用全局 Tauri API 和 `mcp-bridge:default` 权限；插件只在 `debug_assertions` 构建注册，监听 `127.0.0.1`，默认端口 9223（占用时顺延）。常规发布配置不启用全局 API 或桥权限。

```sh
tauri-mcp driver-session start --port 9223
tauri-mcp driver-session status --json
tauri-mcp webview-screenshot --file /tmp/castglean-desktop.png
tauri-mcp manage-window --action list --json
```

必须检查状态中 `connected: true` 和应用标识 `com.yexiyue.castglean`，不能只看 start 成功。截图明确指定文件；元素查询、点击、键盘和 IPC 使用 tauri-mcp，对真实工程写入仍需遵守任务授权。应用重启后重新连接，端口可从启动日志确认。结束调试用 `tauri-mcp driver-session stop`。

后续界面验收优先操作真实宿主，浏览器不再维护另一套制作状态来替代桌面验收。纯函数回归仍可保留；旧模拟结果不能证明原生流程。

2026-11-13 macOS 验证：`pnpm desktop:dev --no-watch` 构建并启动，driver 状态显示 `connected: true`、应用标识 `com.yexiyue.castglean`、桥和 CLI 均为 0.13.2；成功读取主页、点击音色中心并读取真实页面，以及捕获 1360×900 WebView 截图。此结果验证调试通道，不代表全部桌面工作流程已验收。构建时链接器报告大型 `__eh_frame` 警告，构建成功。
