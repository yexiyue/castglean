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

### RC 8 预发布及 macOS 跨版本升级

- [RC 7 Windows](https://github.com/yexiyue/castglean/actions/runs/45799961059) 和 [RC 8 Windows](https://github.com/yexiyue/castglean/actions/runs/45800076655) 的 CPU 与 CUDA NSIS 均生成。两个 macOS runner 在 APPLE_CERTIFICATE 空字符串触发 Tauri 证书导入时失败。同标签 macOS DMG 和更新归档在 Apple Silicon 本机构建，保留独立来源标记。修复提交 `ea222c7` 已从候选构建进程移除 Apple 签名变量，本地回归确认保留 Tauri updater 密钥和密码。
- [汇总运行](https://github.com/yexiyue/castglean/actions/runs/45811931084) 重验两版的安装资产 SHA-256、三个 Tauri 更新签名及签名内的 SemVer，并保留各目标实际来源。RC 7 保留草稿，[RC 8](https://github.com/yexiyue/castglean/releases/tag/v0.1.0-rc.8) 设为 Pre-release。匿名 `latest.json` 正确提供三个独立目标。RC 8 发布 `SHA256SUMS` 文件摘要为 `99dfea6d2f21b646f5ce2a409ce2c6d7a06478afa1a3c7cbfc00bdade1639782`。
- RC 8 DMG SHA-256 为 `e1634e629836e99ad36a53650f2d052e90e9b8b92bab152e5f6e90a0fcee7291`，独立安装的 RC 8 二进制正常启动。重新打开 RC 7 后，从设置发现 RC 8，下载并点击安装重启。原安装路径的 Bundle 版本和启动日志都变为 `0.1.0-rc.8`，关于显示「已是最新版本」，同一测试工程及两章原文可回读。该记录覆盖 macOS 26.6.2 的正常签名更新路径。

### Windows 托管环境跨版本升级

- [Windows CPU 安装升级](https://github.com/yexiyue/castglean/actions/runs/45813402774/job/139886808126) 与 [Windows CUDA 安装升级](https://github.com/yexiyue/castglean/actions/runs/45813402774/job/139886807579) 从对应 RC 7 NSIS 启动真实 Tauri WebView2。两者找到了独立的 RC 8 更新资产，下载并通过签名验证，确认安装后旧进程退出、RC 8 自动启动。两个安装器来自原生 Windows GitHub Actions。
- NSIS 重启后，新进程未继承测试注入的 WebView2 CDP 端口，第二轮验收脚本在重连环节超时。应用自己的启动日志分别记录了 RC 7 和 RC 8。[最终 Windows 验收](https://github.com/yexiyue/castglean/actions/runs/45814366730) 的两个变体均通过。验收确认旧进程退出、同一安装路径上的新进程记录 RC 8、RC 7 的持久数据标记保留，以及 CUDA 运行库仅出现在 CUDA 安装目录。
- Windows 验收使用 GitHub 托管虚拟机。带 NVIDIA 驱动的现有 Windows 验收机离线，无 Toolkit 环境中的 CUDA 真机推理、最低系统与缺 WebView2 的安装路径继续保留为待验项。

### Windows 本机跨版本升级（2026-11-26）

- 验收机为 Windows 11 家庭版 x64（10.0.28000），WebView2 158.0.4370.33，NVIDIA GeForce RTX 5070（驱动 621.40，计算能力 12.0）。使用独立安装路径与候选应用身份，测试工程使用两章合成 TXT。
- CPU 版 RC 7 从 GitHub 草稿下载，安装器 SHA-256 为 `1e6e07e1205f663042ca83ea586fedb9bd1c9ad0773685f8e6fc196227f785c0`。从安装后的应用导入样章，「设置 → 关于」发现 RC 8，手动下载后出现「安装并重启」。确认后旧进程退出，RC 8 在同一安装路径自动启动，PE 版本与启动日志均为 `0.1.0-rc.8`。重开同一工程后两章正文均可读取，CPU 安装目录无 CUDA 运行时 DLL。
- CUDA 版 RC 7 从同一草稿下载，安装器 SHA-256 为 `8bf2e819f746995876a3b5b32d6955054481cd2cac391128954a72ea06107072`。安装后可启动、找到原工程、发现 RC 8。应用内下载进度已观测到 96 MB 以上，切换到通用设置更改主题后，下载仍继续。首轮约 15 分钟后记录响应体读取错误，后续重试记录请求发送错误。应用和安装路径上的版本仍是 RC 7，本机 CUDA 尚无安装、重启和设置回读证据。上述错误发生在下载阶段，未到签名验证与安装阶段。
- RC 8 的 Windows 更新资产为完整 NSIS 安装器，CPU 为 27,551,936 字节，CUDA 为 494,957,980 字节。CUDA 包包含 cuBLAS、cuBLASLt、cuRAND、NVRTC 和 CUDA runtime，其中已安装的 RC 7 `cublasLt64_13.dll` 为 480,401,520 字节。[资产列表](https://github.com/yexiyue/castglean/releases/tag/v0.1.0-rc.8)与[打包规则](../../../.github/scripts/desktop_release.py)可复核这一差异。

### 独立 CUDA 进程可行性（2026-11-26）

- `dumpbin /DEPENDENTS` 确认本机 CUDA RC 7 主程序直接导入 cuBLAS 和 cuRAND，CPU RC 8 主程序无 CUDA 直接导入。将已有的 CUDA TaleChime CLI 复制到隔离目录，清除子进程的 `CUDA_PATH*` 并将 PATH 限于 Windows 系统目录。缺运行库时子进程退出状态为 `0xC0000135`；从已校验的 RC 7 安装复制运行库至隔离目录后，CLI 可启动，Kokoro 模型目录报告可用 CPU 和 CUDA。
- 独立探测进程从同一隔离目录加载 CUDA runtime 和 cuBLAS，使用 RTX 5070 完成 2×2 SGEMM，回读结果为 `[1, 2, 3, 4]`。这覆盖私有目录加载和真实 GPU 算子。本机仍安装 Toolkit，试验只隔离了进程搜索路径。
- 已有 Kokoro 示例二进制要求旧版转换资源，隔离目录下在资源准备阶段退出。随后以锁定的 TaleChime `0812961`、`CUDA_COMPUTE_CAP=120`、`NVCC_APPEND_FLAGS=-Xcompiler=/MD` 重新编译 `kokoro_backend` Release 示例。链接成功并报告 `LNK4098`。主程序集成、组件下载与更新复用均待验收。
- 使用新示例显式选择 Kokoro `1.1-zh-g2pw`、`zf_001` 和 CUDA。资源按锁定引擎的 Hugging Face 清单下载并验证。保留上述子进程搜索路径限制，使用隔离目录中的 RC 7 DLL，在 RTX 5070 上两轮均生成 66,240 个 24 kHz 单声道 PCM 采样，同种子逐位一致；取消后同一引擎重新合成成功。此结果覆盖实际模型推理，不代表无 Toolkit 的干净机器、已签名统一安装包或正式更新已通过。

### RC 9 构建前验证（2026-11-27）

- 新增专用 CUDA worker。Windows 真实进程测试通过 `probe → load → synthesize → shutdown`，宿主客户端验证响应身份和 24 kHz 单声道浮点 WAV。已链接 worker 的直接 CUDA 导入为 cuBLAS 与 cuRAND。Rust 宿主检查、类型绑定导出及前端生产构建通过。
- NVIDIA 原始四个归档共 779,385,407 字节。首轮完整连接读取 NVRTC 响应体时断开，保留约 22 MB。调整为有界分段后从部分文件续传，完整 NVRTC 归档通过固定版本校验并解包。其余大包与整套运行库的就绪、应用内生成和升级复用继续验收。
- 后续实网测试下载并验证四个 NVIDIA 归档，解包后的六个 DLL 均通过固定大小及摘要校验。再次调用准备流程直接复用已校验版本。该轮含续传与网络等待约 22 分钟。
- 本机 RC 9 调试 NSIS 为 83,174,367 字节。装包包含主程序和 CUDA worker，无 CUDA DLL；应用正常启动，模型中心检测并启用已有运行库，样章任务持久化选择了 `cuda`。worker 返回 PCM 后留下 167,084 字节的临时 WAV，但发布失败。Windows 文件刷新需要写权限，发布流程改用可写句柄同步 WAV 后再重命名。修复进入 RC 10。
