# 设置浮层的浏览器验证与 Playwright 定位器

日期：2026-11-14（测试迁移至 `e2e/` 后修订）。适用：Windows + Edge 无头 + fixture 服务器 + 设置浮层（`?settings=` 深链）。

## 常驻挂载的隐藏分区会让宽定位器产生严格模式歧义

症状：设置连接表单测试在 `?settings=models` 页 `page.locator('input[type=password]').fill(...)` 报 strict mode violation——匹配到 2 个元素。

根因是两点叠加：

1. 设置面板里各分区**常驻挂载**（存储位置是 `<div hidden>` 包裹，不卸载），隐藏分区的输入框仍在 DOM 里；
2. `EngineStorageSettings` 根节点自身是 `<section>`（不带 hidden），所以 `section:not([hidden])` 这类祖先限定也拦不住它——隐藏性在更外层的 div 上。

处理：迁移后的 `e2e/settings/llm-settings.spec.mjs` 用 `getByLabel('API 密钥' / 'API key')` 按可访问名定位，天然避开歧义——这是首选写法；临时脚本可用 Playwright 的 `:visible` 伪类（`section:visible input[type=password]`）。写设置相关测试时不要用跨分区的裸元素定位器。

## 浏览器桩与 URL 参数的事实

- `isTauri()`（@tauri-apps/api v2）检查的是 `window.isTauri` 布尔值，**不是** `__TAURI_INTERNALS__`；自制 IPC 桩两者都要装，否则设置页落进「需要桌面应用」的不可用态。
- `?theme=` / `?locale=` 只被 fixture 服务器的特殊路由消费，普通 dev 服务器（1420）上不生效；暗色可临时 `document.documentElement.classList.add('dark')`，语言走真实 UI 切换。`?settings=<分区>` 深链在两个服务器上都有效。
- 迁移后的 e2e 规格统一经 `e2e/managed-browser.mjs` 启动浏览器，个别脚本临时支持 `BROWSER_EXECUTABLE`/`PLAYWRIGHT_MODULE` 覆盖的方式不再需要。

## Windows 平台限制

`tests/unit/tailwind-rules.test.mjs` 用 `spawnSync(node_modules/.bin/biome)` 直接执行无扩展名 shim，Windows 上 ENOENT（status null），在干净工作树上同样失败——是平台性失败，非代码回归；作者环境（macOS）通过。修复方向是改用 `biome.CMD` 或 `shell: true`，尚未处理。`pnpm lint`（biome + check-visual-boundaries）在 Windows 上正常。

## 验证边界

设置浮层的目录操作/取消/主题语言保持与 LLM 连接组合（zh/en × 亮暗 × 1024/720）已在 Windows + Edge 无头通过（迁移前的 `tests/*-browser.mjs` 与迁移后的等价断言）；截屏为 2x deviceScaleFactor。本次视觉核对用无头 CDP + 视觉模型，未做真人原生窗口走查。
