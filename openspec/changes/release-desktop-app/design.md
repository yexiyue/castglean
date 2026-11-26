# Design

## Context

仓库已有 Tauri 2 bundle 配置、应用标识 `com.yexiyue.castglean` 和 Node/Rust 锁文件。CastGlean 从同级 `../talechime` 编译引擎，宿主重复固定 Candle fork 补丁。2026-11-24 的 Kokoro 验收使用调试窗口；GitHub 公开 Releases 页当前无发行记录。应用已有关闭确认和任务状态查询，当前关闭上下文未统计章节音频，且退出路径还要考虑 WAV 导出。[单章原生复验](../../../docs/desktop-studio/chapter-audio-validation.md#2026-11-24-局部重做与版本采用的原生复验) · [GitHub Releases](https://github.com/yexiyue/castglean/releases)

## Goals / Non-Goals

- 让相同发布入口持续产出可追溯的安装文件、更新供给和面向用户的说明。
- 让维护者可以先验证真实资产，再公开发布；让用户在继续工作或安装更新之间自行选择。
- 首发覆盖 macOS Apple Silicon 与 Windows x64，共一个 Mac 包和两个 Windows 变体。托管选用 GitHub 的静态发布资产；灰度、账号授权、独立更新服务及跨平台扩展之后按需求立项。

## Decisions

### 1. 首发平台和两套签名

| 首发目标 | 安装文件 | 合成设备 |
| --- | --- | --- |
| macOS `aarch64-apple-darwin` | DMG | CPU + 系统 Metal |
| Windows `x86_64-pc-windows-msvc` 通用版 | NSIS `setup.exe` | CPU，可在无 NVIDIA 显卡的机器上运行 |
| Windows `x86_64-pc-windows-msvc` CUDA 版 | NSIS `cuda-setup.exe` | 有兼容驱动的 NVIDIA CUDA；模型支持的 CPU 仍可选 |

两个系统的最低版本在核对部署目标后冻结，并在安装包验收中复核。Intel Mac、Windows ARM64 与 Linux 后续按需求和实机能力扩展。Windows 采用 Tauri 的 WebView2 下载引导，验证系统缺少 WebView2 时的安装路径并说明联网要求。用可用的代码签名服务签名和时间戳 Windows 可执行文件及安装器，记录实际 SmartScreen 行为。[Tauri Windows 安装包](https://v2.tauri.app/distribute/windows-installer/) · [Tauri Windows 签名](https://v2.tauri.app/distribute/sign/windows/)

CastGlean 的宿主已针对 macOS 启用 TaleChime Metal 特性，同包编译 CPU。已有原生短句 Metal 证据，正式 DMG 仍要用 Kokoro 跑一次实际章节并记录选择的设备。模型中心按设备探测和模型能力显示选项；设备不可用时可显式改选该模型支持的 CPU，保留生成计划对设备的约束。Metal 随 macOS 提供，用户不用安装开发工具，首次合成仍需准备模型权重。[宿主 Cargo 特性](../../../src-tauri/Cargo.toml) · [音色中心验证](../../../docs/desktop-studio/voice-center-validation.md)

TaleChime 当前为 Kokoro、Qwen、VoxCPM 等提供独立 CUDA 特性，IndexTTS 的 CUDA 特性还带 cuDNN。上游的 Linux CUDA CI 已接线。CastGlean 的 `windows-cuda` feature 转发上游同一组七项 CUDA 能力，IndexTTS/cuDNN 本轮仍使用现有 CPU 路径。公开分发前先用 Kokoro 验证 Windows 原生构建、依赖清单和真机推理。冻结 CUDA 版本、支持的显卡架构及最低驱动，核对所需运行库是否可再分发以及能否应用随附或静态链接。目标是在有兼容 NVIDIA 驱动的干净机器上装包即用，用户无需安装完整 CUDA Toolkit。固定 Candle fork 同时含基于 PTX 的内核与按 compute capability 编译的原生内核，GPU 支持范围以真机验证为准。 Windows 构建使用 NVIDIA 发布清单和逐组件 SHA-256 准备固定版本 Toolkit。NVCC 通过 `NVCC_APPEND_FLAGS=-Xcompiler=/MD` 生成动态 MSVC CRT 对象，与 ONNX Runtime 一致；编译前用 `dumpbin /DIRECTIVES` 核对试编对象。原生 CI 为缩短链接检查关闭 LTO 并启用多 codegen unit，签名发布使用仓库的 release profile。CUDA 版走独立变体，避免直接链接的 CUDA 运行库影响通用版启动。NVIDIA 驱动由用户系统提供。CUDA 版使用固定的自定义 updater target `windows-x86_64-cuda`，通用版继续使用 `windows-x86_64`。发布门禁验证两个变体各自完成原位更新、发布清单不会交叉选包。[TaleChime CUDA 构建配置](https://github.com/yexiyue/talechime/blob/08129613273685a3fe483a90ac1d6f59b9899a55/.github/workflows/qwen-cuda.yml) · [NVIDIA 驱动兼容说明](https://docs.nvidia.com/deploy/cuda-compatibility/latest/minor-version-compatibility.html)

Developer ID Application 签名与 Apple 公证、票据装订服务于 Gatekeeper。应用包和 DMG 按 Apple 分发指引验证，确认更新归档内的应用也带正式身份和票据。Tauri 更新包另用更新私钥签名，公钥随应用内置。初次公开稳定版以两项签名及实机通过为条件。Apple 凭据未就绪时，ad-hoc 包可用于内部构建检查，公开稳定版继续等待 Developer ID 和公证条件。[Apple DMG 分发指南](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution) · [Tauri macOS 签名](https://v2.tauri.app/distribute/sign/macos/) · [Tauri Updater](https://v2.tauri.app/plugin/updater/)

更新私钥由维护者生成并保留可恢复的离线备份，CI 仅在受保护的签名任务读取密钥与密码。Apple 凭据用独立 secrets 和临时钥匙串，构建后清理。测试夹具使用测试密钥。Apple 证书续期与 updater 信任根迁移分别记录。更新私钥丢失或泄露时，现有客户端无法凭一个新的公钥安全恢复更新信任，走官方重新下载安装路径并公告；密钥仍可信时用签名的更高版本推动修复。实施时核对仓库可用的 GitHub 环境权限，正式发布由维护者显式触发。[GitHub Actions 安全用法](https://docs.github.com/en/actions/reference/security/secure-use)

### 2. 版本、构建和晋级

- 仓库中的 Tauri 应用版本是发布版本来源。正式版使用 `vMAJOR.MINOR.PATCH`，候选版使用 `vMAJOR.MINOR.PATCH-rc.N`。发布前检查标签、应用配置、Cargo 和前端包元数据及锁文件的一致性，核对打包后应用的版本。当前 `0.1.0` 可作为首发号，实施时先核对可用标签。稳定标签必须能从受保护的发布分支追溯到已审查提交。
- 干净的 macOS 和 Windows 原生 runner 使用独立相邻目录 checkout CastGlean 和 TaleChime。TaleChime 的完整 SHA 写入仓库的发布配置，由 CI 校验实际 checkout、宿主/上游 Candle 补丁和 Cargo 解析结果。初始核对基线为本机用于开发的 TaleChime `08129613273685a3fe483a90ac1d6f59b9899a55`，在锁定前确认远端可取并完成发布构建。锁定 Node、pnpm、Rust、Actions SHA 和 runner 标签，记录实际镜像、SDK 及工具版本。构建使用 pnpm frozen lockfile 和 Cargo locked 解析并检查构建后锁文件。复用 sibling 布局可保持本地引擎联调，迁移到已发布 crate 或 git dependency 可随依赖策略单独评估。[actions/checkout](https://github.com/actions/checkout)
- PR 校验和内部候选构建使用低权限，外部 PR 无签名秘密。候选和稳定标签复用同一套 Tauri 构建、签名、公证和资产验证。Tauri CLI 或固定版本的 `tauri-action` 负责编译打包。由独立汇总任务一次生成完整清单与校验和，一次写入草稿；后续可增平台而无需各构建任务并发修改同一份清单。仅草稿汇总和显式发布步骤获得 Release 写权限。[Tauri GitHub 工作流](https://v2.tauri.app/distribute/pipelines/github/) · [tauri-action](https://github.com/tauri-apps/tauri-action)
- 同标签串行构建与晋级。草稿可在重试时复用，存在同名但不同摘要的资产时停止并记录原因。维护者从草稿下载各平台安装包，按资产摘要记录真机验收；发布入口复核目标版本、构建提交、当前草稿资产和验收记录。公开后保持标签、资产与签名不变。维护者可为仓库启用 GitHub immutable releases，启用前核对异常处置方式。前序 TaleChime Release CI 的全门禁聚合语义可参考，桌面包使用 Tauri 的产物链。[GitHub 草稿与发布](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) · [Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)

### 3. Release 内容与资产

Release 页面标题采用 `CastGlean vX.Y.Z`。仓库中为每一版审阅面向用户的 Markdown，发布工作流按同一份输入生成页面和摘要。页面写清版本和渠道、用户可用能力与修复、下载文件及系统要求、安装和升级步骤、已知问题、第三方许可，以及问题反馈入口。GitHub 自动生成的贡献列表和比较链接可作为附录。更新面板读取同版简短说明并链接该版本页，本地化控件由应用提供，首发说明以中文为主。应用以纯文本或安全 Markdown 展示远程说明。[GitHub 自动发行说明](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes)

| 资产 | 用途 |
| --- | --- |
| `CastGlean_<version>_aarch64.dmg` | 面向用户。签名、公证和装订后的首次安装文件 |
| `CastGlean_<version>_aarch64.app.tar.gz` 及 `.sig` | 面向更新器。来自同一构建的 macOS 应用归档与对应签名 |
| `CastGlean_<version>_x64-setup.exe` 及 `.sig` | Windows NSIS 安装器及更新签名。签名完成的同一安装器字节同时用于手动安装和更新 |
| `CastGlean_<version>_x64-cuda-setup.exe` 及 `.sig` | Windows CUDA 安装器和更新签名 |
| `latest.json` | 更新元数据。记录版本、更新摘要、发布时间及 `darwin-aarch64`、`windows-x86_64`、`windows-x86_64-cuda` 各自的版本固定下载 URL 与签名内容 |
| `SHA256SUMS`、构建清单、第三方许可 | 供人工核对。清单提供 CastGlean/TaleChime SHA、构建运行、工具版本、目标、资产名与摘要。SHA256SUMS 覆盖最终安装和更新资产等分发文件，不含自身；许可同时随应用分发 |

模型资源继续通过现有模型中心准备，Release 说明列出首章建议模型、首次下载需求和本地缓存位置。装包前核对引擎、Candle fork、前端 vendored 组件和实际随应用分发的依赖及许可；仅在运行时下载的模型及其使用条款在文档说明。

首发发布说明的用户正文可从以下内容开始，公开前填入实测系统与实际资产链接。

> CastGlean 的首个桌面版本支持 Apple Silicon Mac 和 x64 Windows。Mac 下载 DMG 并拖入「应用程序」，Windows 下载并运行 setup.exe。Mac 支持 CPU 和 Metal，Windows 提供 CPU 通用版及适用于兼容 NVIDIA 显卡的 CUDA 版。首次合成请在模型中心准备 Kokoro 中文模型。
>
> 你可以导入 TXT、分章、手动调整角色归属并绑定音色，生成和播放单章。改动后可以局部重做或重录，试听并采用满意的版本，再导出 WAV。
>
> 应用会检查新版本，也可在设置中手动检查。你可以查看变更并选择何时安装。首版提供单章制作。支持的系统版本、已验证模型和设备、已知限制与反馈入口在下方列明。

### 4. 更新源与应用交互

- 稳定版读取 CastGlean 公共 GitHub Releases 的 `releases/latest/download/latest.json`，清单中的更新包 URL 固定到对应发布标签。只接受 HTTPS、对应平台和更高稳定 SemVer，并由插件校验内置公钥对应的更新资产签名。三个发布目标的静态清单及签名均校验通过后才允许发布。维护者明确选择新发布成为 Latest，并从匿名客户端确认重定向与下载结果。[Tauri 静态更新清单](https://v2.tauri.app/plugin/updater/#static-json-file) · [GitHub Latest Release](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
- 首发使用两份明确标为候选的包演练，旧候选的构建配置固定指向新候选预先确定的版本化 GitHub Release 清单。两个候选使用同一候选应用身份和隔离数据，且与稳定版身份和端点分离。候选以 GitHub Pre-release 暴露当天验收资产，不设置为 Latest。候选包走实际公证和更新签名，使用与稳定发行相同的构建逻辑及受保护的签名流程。候选更新使用独立密钥，两份候选共享该渠道公钥。稳定包的实际更新归档在发布前用稳定包内置的公钥校验。首包发布后再用下一稳定版补记稳定源上的跨版本实测。
- 更新状态由 Rust 宿主持有，前端经类型化 IPC 显示。正式安装包在界面可用后非阻塞检查一次，在设置提供手动检查。检查或下载进度可有界重试。无新版本、网络或清单异常、签名失败和安装失败各有明确状态。已发现版本显示版本号、摘要及详情链接。一旦用户确认，单一下载流程报告真实进度，可稍后安装。开发与浏览器环境不访问正式源。
- 安装前由宿主重新检查运行中的章节生成与 WAV 导出、模型/音色传输、试听与 AI 等相关任务。检查失败或任务仍活跃，保留当前应用并给出原因。应用复用现有关闭路径的未保存编辑决策，完成保存或用户明确选择放弃后进入安装。宿主在最终空闲检查到重启之间禁止接收新的冲突任务，安装异常时释放该状态且允许重试。插件的安装能力留在宿主；前端入口仅暴露本地 UI 所需动作，不开放远程文档调用或任意端点配置。[Tauri Capabilities](https://v2.tauri.app/security/capabilities/) · [Tauri 下载与安装 API](https://v2.tauri.app/plugin/updater/#checking-for-updates)

## Risks / Trade-offs

- **GitHub 网络可达性。** 在目标使用网络验证匿名下载、重定向和超时恢复。首次公开路径仍指向版本化 GitHub Release，失败应给出可重试状态。若验收暴露长期可达性问题，另行评估可托管相同签名资产的镜像。
- **首次启动与数据目录。** 公共安装包使用当前应用标识。真机用新用户或隔离目录检查 Gatekeeper、初始引导、运行时资源与数据路径，再用已制作数据验证更新。应用就绪和模型首次下载各自记录。生产版验证不借助调试桥。
- **已发布版本故障。** 先确认最新指针、坏资产和影响范围；必要时在 GitHub 支持且实际验证匿名路由的前提下把 Latest 指回已知好版本以停止推送，随后发更高版本修复。首次发布无好版本时走公告和向前修复。已升级用户维持正常 SemVer 规则，数据迁移异常使用现有备份路径，处理方案不依赖覆盖已发布资产或强制降级。

## Migration Plan

1. 固定发布版本、依赖、首发系统范围与签名设备/权限，建立构建、草稿与晋级入口。
2. 运行候选 A → B。在两平台分别下载候选安装包，准备 Kokoro，导入可公开 TXT，生成、播放、局部修正和导出。通过应用的真实更新 UI 升级，复查工程、采用版本、停顿、设置、音色、模型缓存及 WAV。分别保留成功以及中断、错误签名和活动任务保护的证据。
3. 构建独立稳定草稿，按其实际摘要再次验收三个最终安装包的干净安装、首次启动和单章闭环。发布同一批字节，复查匿名下载、资产摘要、版本化 URL、签名与 Latest。首个稳定客户端检查当前版本，应显示已经是最新版本。
4. 用下一稳定版补做稳定 A → B，并在发布验收记录中注明真实版本、系统、资产摘要和数据回读结果。
