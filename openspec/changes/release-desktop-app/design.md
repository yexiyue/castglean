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
| Windows `x86_64-pc-windows-msvc` | NSIS `setup.exe` | CPU 默认可用，CUDA 由模型中心按需准备 |

两个系统的最低版本在核对部署目标后冻结，并在安装包验收中复核。Intel Mac、Windows ARM64 与 Linux 后续按需求和实机能力扩展。Windows 采用 Tauri 的 WebView2 下载引导，验证系统缺少 WebView2 时的安装路径并说明联网要求。用可用的代码签名服务签名和时间戳 Windows 可执行文件及安装器，记录实际 SmartScreen 行为。[Tauri Windows 安装包](https://v2.tauri.app/distribute/windows-installer/) · [Tauri Windows 签名](https://v2.tauri.app/distribute/sign/windows/)

CastGlean 的 Apple Silicon 安装包同时编译 TaleChime CPU 和 Metal。用户在章节音频设置中选择合成设备，首次默认使用 CPU。生成前检查和新任务提交均向 TaleChime 查询章内实际使用的模型是否支持 Metal。若不可用，设置和预检保留切回 CPU 的入口。两种设备使用同一个章节执行器、音频持久化、播放和 WAV 导出流程。任务冻结设备，续跑与重录沿用原设备；切换设备后发起新版本，跨设备的旧音频单元不参与沿用。Metal 随 macOS 提供，首次合成仍需准备模型权重。[宿主 Cargo 特性](../../../src-tauri/Cargo.toml) · [章节设备选择](../../../src-tauri/src/chapter_audio/commands.rs)

Windows CUDA 特性继续复用 TaleChime 与固定 Candle fork，首轮以 Kokoro 验证，其他模型按实测开放。Windows 构建保留固定 NVIDIA Toolkit、逐组件校验、MSVC 动态 CRT 和 CUDA 编译目标证据。驱动由系统提供，运行库版本和支持的设备以实际推理核对。

### Windows CUDA 推理与运行库边界

- 桌面主程序沿用 Windows CPU 宿主，按需启动由同一发行版本构建和签名的 CUDA 推理进程。进程协议带版本、请求身份、有界队列和取消语义。Rust 宿主持有任务、资源身份和持久化，CUDA 子进程管理进程内模型及推理，输出经过校验后才由宿主采纳。子进程不可写用户工程；进程退出或崩溃后按现有失败、取消和重试语义处理。
- 现有 TaleChime CLI 协议用于播放且不输出 PCM，验证可复用其类型和生命周期做法；正式宿主需要合成输出接口。优先验证从经校验私有目录启动签名 worker，使用宿主分配的暂存文件回交有上限、可验证的音频，宿主负责取消后的清理与发布。
- 由模型中心区分显卡不适用、驱动需要更新、运行库待下载和真实探测通过。首次选 CUDA 时显示总大小并确认，随后在隔离的版本目录准备文件。固定组件来源、摘要、版本及引擎对应关系。优先从 NVIDIA 官方重分发组件端点取件，正式分发前逐组件核对许可；不要求用户安装 Toolkit。
- 下载使用可重试的临时文件，续传只请求固定 URL 并核对响应范围。完整归档通过清单固定的 SHA-256 校验后再解包，DLL 校验通过后原子启用。推理进程从经验证的应用私有目录加载 DLL，使用受限搜索路径，不依赖系统 PATH 或 CUDA_PATH。已就绪版本可以离线复用，更换版本时保留上一份可用组件，应用更新不覆盖组件目录。
- 统一包仅使用 `windows-x86_64` 更新目标。历史双包用户可手动安装当前候选包，继续使用原应用身份和工程目录。独立 CUDA 运行库按当前清单验证。
- 新章节只在本次运行已确认 CUDA 就绪时选择 CUDA。续跑和重录使用原任务记录的设备，设备不可用时拒绝提交，已完成单元和采用版本继续可读。

Developer ID Application 签名与 Apple 公证、票据装订服务于 Gatekeeper。应用包和 DMG 按 Apple 分发指引验证，确认更新归档内的应用也带正式身份和票据。Tauri 更新包另用更新私钥签名，公钥随应用内置。初次公开稳定版以两项签名及实机通过为条件。首轮候选使用 macOS ad-hoc 签名以便在 Apple Silicon 上运行，并跳过 Developer ID、公证与装订。Windows 候选跳过 Authenticode。按安装测试设备实际出现的 Gatekeeper 和 SmartScreen 提示记录安装步骤。[Apple DMG 分发指南](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution) · [Tauri macOS 签名](https://v2.tauri.app/distribute/sign/macos/) · [Tauri Updater](https://v2.tauri.app/plugin/updater/)

更新私钥由维护者生成并保留可恢复的离线备份，CI 仅在受保护的签名任务读取密钥与密码。Apple 凭据用独立 secrets 和临时钥匙串，构建后清理。测试夹具使用测试密钥。Apple 证书续期与 updater 信任根迁移分别记录。更新私钥丢失或泄露时，现有客户端无法凭一个新的公钥安全恢复更新信任，走官方重新下载安装路径并公告；密钥仍可信时用签名的更高版本推动修复。实施时核对仓库可用的 GitHub 环境权限，正式发布由维护者显式触发。[GitHub Actions 安全用法](https://docs.github.com/en/actions/reference/security/secure-use)

### 2. 版本、构建和晋级

- 仓库中的 Tauri 应用版本是发布版本来源。正式版使用 `vMAJOR.MINOR.PATCH`，候选版使用 `vMAJOR.MINOR.PATCH-rc.N`。发布前检查标签、应用配置、Cargo 和前端包元数据及锁文件的一致性，核对打包后应用的版本。当前 `0.1.0` 可作为首发号，实施时先核对可用标签。候选标签必须能从 `develop` 追溯。稳定标签必须能从 `main` 追溯到已审查提交。
- 干净的 macOS 和 Windows 原生 runner 使用独立相邻目录 checkout CastGlean 和 TaleChime。TaleChime 的完整 SHA 写入仓库的发布配置，由 CI 校验实际 checkout、宿主/上游 Candle 补丁和 Cargo 解析结果。初始核对基线为本机用于开发的 TaleChime `08129613273685a3fe483a90ac1d6f59b9899a55`，在锁定前确认远端可取并完成发布构建。锁定 Node、pnpm、Rust、Actions SHA 和 runner 标签，记录实际镜像、SDK 及工具版本。构建使用 pnpm frozen lockfile 和 Cargo locked 解析并检查构建后锁文件。复用 sibling 布局可保持本地引擎联调，迁移到已发布 crate 或 git dependency 可随依赖策略单独评估。[actions/checkout](https://github.com/actions/checkout)
- PR 校验和内部候选构建使用低权限，外部 PR 无签名秘密。候选和稳定标签复用 Tauri 构建、更新签名与资产验证。稳定版检查平台签名、公证及时间戳。候选标签推送可触发构建，更新端点由标记提交的 `candidate_feed_tag` 决定。Tauri CLI 或固定版本的 `tauri-action` 负责编译打包。由独立汇总任务一次生成完整清单与校验和，一次写入草稿；后续可增平台而无需各构建任务并发修改同一份清单。仅草稿汇总和显式发布步骤获得 Release 写权限。[Tauri GitHub 工作流](https://v2.tauri.app/distribute/pipelines/github/) · [tauri-action](https://github.com/tauri-apps/tauri-action)
- 同标签串行构建与晋级。草稿可在重试时复用，存在同名但不同摘要的资产时停止并记录原因。维护者从草稿下载各平台安装包，按资产摘要记录真机验收；发布入口复核目标版本、构建提交、当前草稿资产和验收记录。公开后保持标签、资产与签名不变。维护者可为仓库启用 GitHub immutable releases，启用前核对异常处置方式。前序 TaleChime Release CI 的全门禁聚合语义可参考，桌面包使用 Tauri 的产物链。[GitHub 草稿与发布](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) · [Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)

### 3. Release 内容与资产

Release 页面标题采用 `CastGlean vX.Y.Z`。仓库中为每一版审阅面向用户的 Markdown，发布工作流按同一份输入生成页面和摘要。页面写清版本和渠道、用户可用能力与修复、下载文件及系统要求、安装和升级步骤、已知问题、第三方许可，以及问题反馈入口。GitHub 自动生成的贡献列表和比较链接可作为附录。更新面板读取同版简短说明并链接该版本页，本地化控件由应用提供，首发说明以中文为主。应用以纯文本或安全 Markdown 展示远程说明。[GitHub 自动发行说明](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes)

| 资产 | 用途 |
| --- | --- |
| `CastGlean_<version>_aarch64.dmg` | 面向用户。签名、公证和装订后的首次安装文件 |
| `CastGlean_<version>_aarch64.app.tar.gz` 及 `.sig` | 面向更新器。来自同一构建的 macOS 应用归档与对应签名 |
| `CastGlean_<version>_x64-setup.exe` 及 `.sig` | Windows NSIS 安装器及更新签名。签名完成的同一安装器字节同时用于手动安装和更新 |
| `latest.json` | 更新元数据。记录版本、更新摘要、发布时间及 `darwin-aarch64` 和 `windows-x86_64` 各自的版本固定下载 URL 与签名内容 |
| `SHA256SUMS`、构建清单、第三方许可 | 供人工核对。清单提供 CastGlean/TaleChime SHA、构建运行、工具版本、目标、资产名与摘要。SHA256SUMS 覆盖最终安装和更新资产等分发文件，不含自身；许可同时随应用分发 |

模型资源继续通过现有模型中心准备，Release 说明列出首章建议模型、首次下载需求和本地缓存位置。装包前核对引擎、Candle fork、前端 vendored 组件和实际随应用分发的依赖及许可；仅在运行时下载的模型及其使用条款在文档说明。

首发发布说明的用户正文可从以下内容开始，公开前填入实测系统与实际资产链接。

> CastGlean 的首个桌面版本支持 Apple Silicon Mac 和 x64 Windows。Mac 下载 DMG 并拖入「应用程序」，Windows 下载并运行 setup.exe。Mac 支持 CPU 和 Metal，Windows 默认可用 CPU，兼容 NVIDIA 显卡可在模型中心启用 CUDA。首次合成请在模型中心准备 Kokoro 中文模型。
>
> 你可以导入 TXT、分章、手动调整角色归属并绑定音色，生成和播放单章。改动后可以局部重做或重录，试听并采用满意的版本，再导出 WAV。
>
> 应用会检查新版本，也可在设置中手动检查。你可以查看变更并选择何时安装。首版提供单章制作。支持的系统版本、已验证模型和设备、已知限制与反馈入口在下方列明。

### 4. 更新源与应用交互

- 稳定版读取 CastGlean 公共 GitHub Releases 的 `releases/latest/download/latest.json`，清单中的更新包 URL 固定到对应发布标签。只接受 HTTPS、对应平台和更高稳定 SemVer，并由插件校验内置公钥对应的更新资产签名。两个发布目标的静态清单及签名均校验通过后才允许发布。维护者明确选择新发布成为 Latest，并从匿名客户端确认重定向与下载结果。[Tauri 静态更新清单](https://v2.tauri.app/plugin/updater/#static-json-file) · [GitHub Latest Release](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
- 首发使用两份明确标为候选的包演练，旧候选的构建配置固定指向新候选预先确定的版本化 GitHub Release 清单。两个候选使用同一候选应用身份和隔离数据，且与稳定版身份和端点分离。候选以 GitHub Pre-release 暴露当天验收资产，不设置为 Latest。候选包使用受保护的更新签名环境。验收人员可从草稿下载 A，B 需成为公开预发布才可供候选客户端匿名查找和下载。候选更新使用独立密钥，两份候选共享该渠道公钥。稳定包的实际更新归档在发布前用稳定包内置的公钥校验。首包发布后再用下一稳定版补记稳定源上的跨版本实测。
- 更新状态由 Rust 宿主持有，前端经类型化 IPC 显示。正式安装包在界面可用后非阻塞检查一次，在设置提供手动检查。检查或下载进度可有界重试。无新版本、网络或清单异常、签名失败和安装失败各有明确状态。已发现版本显示版本号、摘要及详情链接。一旦用户确认，单一下载流程报告真实进度，可稍后安装。开发与浏览器环境不访问正式源。
- 安装前由宿主重新检查运行中的章节生成与 WAV 导出、模型/音色传输、试听与 AI 等相关任务。检查失败或任务仍活跃，保留当前应用并给出原因。应用复用现有关闭路径的未保存编辑决策，完成保存或用户明确选择放弃后进入安装。宿主在最终空闲检查到重启之间禁止接收新的冲突任务，安装异常时释放该状态且允许重试。插件的安装能力留在宿主；前端入口仅暴露本地 UI 所需动作，不开放远程文档调用或任意端点配置。[Tauri Capabilities](https://v2.tauri.app/security/capabilities/) · [Tauri 下载与安装 API](https://v2.tauri.app/plugin/updater/#checking-for-updates)

## Risks / Trade-offs

- **GitHub 网络可达性。** 在目标使用网络验证匿名下载、重定向和超时恢复。首次公开路径仍指向版本化 GitHub Release，失败应给出可重试状态。若验收暴露长期可达性问题，另行评估可托管相同签名资产的镜像。
- **首次启动与数据目录。** 公共安装包使用当前应用标识。真机用新用户或隔离目录检查 Gatekeeper、初始引导、运行时资源与数据路径，再用已制作数据验证更新。应用就绪和模型首次下载各自记录。生产版验证不借助调试桥。
- **已发布版本故障。** 先确认最新指针、坏资产和影响范围；必要时在 GitHub 支持且实际验证匿名路由的前提下把 Latest 指回已知好版本以停止推送，随后发更高版本修复。首次发布无好版本时走公告和向前修复。已升级用户维持正常 SemVer 规则，数据迁移异常使用现有备份路径，处理方案不依赖覆盖已发布资产或强制降级。

## Migration Plan

1. 固定发布版本、依赖、首发系统范围与签名设备/权限，建立构建、草稿与晋级入口。
2. 运行候选 A → B。在两平台分别下载候选安装包，准备 Kokoro，导入可公开 TXT，生成、播放、局部修正和导出。通过应用的真实更新 UI 升级，复查工程、采用版本、停顿、设置、音色、模型缓存及 WAV。分别保留成功以及中断、错误签名和活动任务保护的证据。
3. 构建独立稳定草稿，按其实际摘要再次验收两个最终安装包的干净安装、首次启动和单章闭环。发布同一批字节，复查匿名下载、资产摘要、版本化 URL、签名与 Latest。首个稳定客户端检查当前版本，应显示已经是最新版本。
4. 用下一稳定版补做稳定 A → B，并在发布验收记录中注明真实版本、系统、资产摘要和数据回读结果。
