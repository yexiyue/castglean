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

三目标 Release 和应用更新实现均已接线并通过本地验证。开发签名夹具覆盖汇总和篡改拒绝，浏览器夹具覆盖确认和活动任务保护。稳定签名环境尚未配置。候选签名环境已配置独立 Tauri 密钥及标签审批。公开预发布、实际装包、候选更新和 NVIDIA 真机合成以对应验收记录为准。

## 候选打包排障

- [RC 1](https://github.com/yexiyue/castglean/actions/runs/45798400199) 和 [RC 2](https://github.com/yexiyue/castglean/actions/runs/45798400591) 的 Windows 打包分别暴露两个问题。NVRTC 通配符匹配了标准 DLL 和 `.alt.dll`。Git Bash 将 GNU `link.exe` 放在 MSVC 链接器前面。已收窄 DLL 文件名匹配，并在 Release 构建步使用 runner 默认 shell。以当前 GitHub 三目标产物为验收依据。
- [RC 7](https://github.com/yexiyue/castglean/actions/runs/45799961059) 安装器使用 [RC 8](https://github.com/yexiyue/castglean/actions/runs/45800076655) 的固定更新源。当前 Release 和 Windows 验收工作流通过 actionlint，构建脚本的 NVRTC 规则通过同时包含标准 DLL 与 `.alt.dll` 的回归检查。

### macOS RC 7 本机构建和原生装包

- macOS 26.6.2 Apple Silicon，CastGlean 提交 `45087c7`。本机使用候选公钥和签名密钥生成 DMG、更新归档及 .sig。安装 DMG 的 SHA-256 为 `18527b98b82c6be402e5c20c3796a79b5022288db541f0a520eceabbe9e98eda`。
- 挂载 DMG 后复制应用到独立验收目录，验证 arm64、ad-hoc 签名和 `com.yexiyue.castglean.rc`，启动后在关于页面确认 `0.1.0-rc.7`。导入合成 TXT 后恢复出两章，样章 SHA-256 为 `076a97603e96ff2f48040f8ec9e7583b3d2cffa57277143b329f82c39a385314`。
- RC 8 更新源尚未公开时，应用显示检查失败。此条为本机构建的装包与数据准备证据，跨版本升级及 GitHub 产物另行验证。
