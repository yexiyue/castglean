# 桌面发行操作

## Windows 原生构建

Windows native builds 使用独立 CPU/CUDA job。两个 job 在 Windows x64 上链接桌面可执行文件。CUDA 构建使用 `.github/desktop-build.json` 中的 Toolkit 与 compute capability，首轮 `120` 用于验证 RTX 50 系列构建配置。支持的 GPU 与驱动范围以下载包实测为准。

## 配置签名

在 GitHub 中创建 `desktop-stable-signing` 和 `desktop-candidate-signing`，按仓库权限配置保护规则和维护者审核。两个环境分别配置 Tauri 更新密钥，备份私钥并保留公钥供复验。配置 `desktop-publication` 的维护者审核。

| 类型 | 环境项 |
| --- | --- |
| Tauri 签名 secrets | `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |
| Tauri 变量 | `CASTGLEAN_UPDATE_PUBLIC_KEY` |
| Apple secrets | `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_ID`、`APPLE_PASSWORD` |
| Apple 变量 | `APPLE_SIGNING_IDENTITY`、`APPLE_TEAM_ID` |
| Windows secrets | `WINDOWS_CERTIFICATE`（base64 PFX）、`WINDOWS_CERTIFICATE_PASSWORD` |

Windows 签名需要能在 runner 上由 SignTool 使用的受信任签名身份。如果采用远端签名服务，调整 Windows 的签名步骤及凭据来源，通过同样的签名验证。公钥值是 Tauri signer 生成的 `.pub` 文件内容。

## 从标签生成候选与正式草稿

1. 将 Tauri、Cargo、前端版本及 Cargo.lock 对齐，检查首发分支与 TaleChime pin。给每个发行标签准备 `.github/release-notes/<tag>.md`，正式发版前根据候选实测填写支持的系统、NVIDIA 显卡和驱动，移除 `pending-platform-verification` 标记。
2. 从 `main` 的已审查提交创建标签。候选版本 A 配置固定指向 B 的候选 feed，两版使用同一候选身份与候选公钥，稳定环境使用正式公钥。候选草稿用 `gh workflow run desktop-release.yml --ref <rc-tag> -f rc_feed_tag=<candidate-B-tag>` 构建。候选标签由手动入口受理。稳定标签自动触发三个签名构建和草稿汇总。
3. 从草稿下载安装器，先核对 `SHA256SUMS`，再按里程碑任务记录两个平台和三个目标的装包与数据验证。归档验收记录的 HTTPS 地址和草稿 `SHA256SUMS` 文件本身的 SHA-256。A 与 B 各有三个包。先从草稿下载并验收 A 和 B 的独立安装，保留 A 中的隔离样章和制作数据。
4. 从对应标签执行 `gh workflow run desktop-release.yml --ref <tag> -f publish=true -f checked_sha256=<digest> -f acceptance=<https-url>`。发布 job 从 GitHub 重新下载已测试的草稿，核对标签、构建身份和资产清单。先把验收通过的 B 草稿发布为 GitHub Pre-release，供已安装的 A 在应用内获取签名更新。A 可以继续留在草稿。三个目标完成 A → B 后核对版本、已有工程、采用音频、停顿及设置保留。发布任务会匿名验证更新源与资产字节。
5. 保存构建运行、验收记录、GitHub Release 链接和真实应用显示的版本。稳定渠道 A → B 的真机升级证据随下一稳定版补齐。

每次重试核对现有资产，同名不同摘要时停止。公开资产有故障时按设计处理 Latest 指针和更高版本修复。保留实际发布的标签与文件。
