# Proposal

## Why

CastGlean 已在 macOS 原生调试窗口跑通单章制作，下一步需要交付用户可以下载、安装并持续升级的桌面应用。首发应建立可重复使用的版本、签名、发布说明与实机验收流程，每次发布都能追溯到实际验证的产物。

## What Changes

- 用 GitHub Actions 构建带版本号的 Tauri 安装包。首发覆盖 macOS Apple Silicon 和 Windows x64。macOS 提供签名公证 DMG，Windows 提供 CPU 通用版与 CUDA 版签名 NSIS 安装包。
- 通过 GitHub Release 草稿汇总安装包、签名更新包、更新清单、校验和及发布说明。经实机验收后发布，并检查匿名下载和稳定更新源。
- 接入 Tauri 2 自动更新。应用非阻塞检查新版本，用户可在设置中主动检查和查看变更，确认后下载、校验、安装并重启。安装时保护活动中的任务及未保存编辑。
- 候选包以独立 Tauri updater 密钥签名，先跳过 Apple Developer ID、公证和 Windows Authenticode，演练真实跨版本更新。稳定版从首包开始接入稳定源，后续用第一对正式版本补齐稳定到稳定的真机证据。
- macOS 首发包内置 CPU 与 Metal，Windows x64 首发交付 CPU 通用版和 CUDA 版。CUDA 版通过原生 MSVC 构建、兼容 NVIDIA 真机和独立更新目标验收后与 CPU 版同批发布。Intel Mac、Windows ARM64、Linux、多章队列和独立更新服务列为后续工作。

## Capabilities

### New Capabilities

- `desktop-distribution` 提供可追溯的安装包、渠道、GitHub Release 内容及装包验收。
- `desktop-updates` 提供可信更新发现、用户确认安装、失败反馈以及对本地制作状态的保护。

### Modified Capabilities

无。

## Impact

涉及 GitHub Actions、Tauri release 配置、发布元数据与说明、Rust 更新服务、设置页及中英文案。CI 复用现有 TaleChime sibling checkout 布局和 Candle 补丁。首发采用现有应用标识和本地数据契约，更新流程需验证实际工程、音色和缓存路径。
