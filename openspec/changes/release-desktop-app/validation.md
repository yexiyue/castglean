# 桌面分发验证

## 本地检查

- 发布与 Windows 原生构建工作流通过 actionlint。Python 发布与 CUDA 准备脚本通过语法检查。
- 使用临时 Tauri 测试签名密钥签署三个小型模拟包。汇总生成 macOS、Windows CPU 和 Windows CUDA 三个清单入口，确认 CUDA 指向独立资产。同步修改包和构建摘要后，Minisign 校验仍拒绝篡改包。
- macOS 库 Clippy、Specta 导出和 Lingui 严格编译通过。隔离提交基线上的更新目标、安装互斥两项 Rust 测试及前端生产构建通过。Chromium 更新夹具验证下载后的安装先被活动任务拦截，任务结束后用户可再次确认安装。
- 当前工作区通过 TypeScript、前端生产构建、100 项前端单测、Lint（14 条既有样式排序警告）、Rust fmt、全目标 Clippy、rustdoc 和 OpenSpec 严格校验。Rust 库 473 项通过、12 项忽略，另有 2 项集成通过、2 项忽略。更新及设置草稿退出保护的两项 Chromium 回归通过。

## GitHub Actions 原生构建

- [首次运行](https://github.com/yexiyue/castglean/actions/runs/45785303917)暴露 PowerShell 参数传递和 CUDA 网络安装器失败。改用参数数组传递原生 CLI 分隔符。
- [第二轮 Windows CPU job](https://github.com/yexiyue/castglean/actions/runs/45786195859/job/139793441902)通过，Windows x64 原生编译与链接生成 `castglean.exe`。同轮 CUDA 本地安装器仍失败，未进入编译。
- [NVIDIA ZIP 方案运行](https://github.com/yexiyue/castglean/actions/runs/45787311182)使用固定发布清单和组件 SHA-256 准备工具链，CPU 再次通过。CUDA 完成内核编译，链接暴露 Candle 的 `MT_StaticRelease` 与 ONNX Runtime 的 `MD_DynamicRelease` 冲突（LNK2038）。下一轮采用 `/MD` 并先检查 CUDA 对象的链接指令。
- [动态 CRT 修复运行](https://github.com/yexiyue/castglean/actions/runs/45791755893/job/139812265963)通过。NVCC 试编对象的 MSVC 指令为 `MD_DynamicRelease`，完整 Windows x64 CUDA job 编译、链接并生成 `castglean.exe`。此次原生链接检查关闭了 LTO 并使用 16 个 codegen unit。CUDA Toolkit 固定为 13.0.2，计算能力为 120。

## 签名分发边界

三目标 Release 和应用更新实现均已接线并通过本地验证。开发签名夹具覆盖汇总和篡改拒绝，浏览器夹具覆盖确认和活动任务保护。正式签名环境尚未配置，公开 Release、实际安装器和 NVIDIA 真机合成仍需验收。
