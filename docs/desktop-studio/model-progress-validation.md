# 模型下载进度与缓存入口验证

2026-11-04，CastGlean 分支 `codex/model-progress-channel`；配套 TaleChime 分支 `codex/download-progress-coalescing`。本次不发布。TaleChime 配套源码提交为 `1002fb8`。

## 行为与边界

进度改用 Tauri IPC Channel；宿主仍保留任务叠加状态和磁盘盘点。每次订阅先接收一致快照，再接收有序更新。任务 ID 隔离重试，序号拒绝迟到更新，终态不能被重新改回下载中。页面离开、手动刷新和 WebView 重载清理旧订阅；断开订阅不会取消下载。

源下载回调只更新 watch 中的最新值，不阻塞网络读取。转发在原下载 future 的生命周期内执行，队列满时保留最新值，成功/失败返回前补发准确字节；失败不冒充完成。宿主按文件高水位聚合，约 100ms 合并一次，EOF 补发后立即发送终态。前端保留浮点百分比，消除大文件整数百分比导致的静止感。该节奏取决于上游实际产生进度，不承诺网络等待期间增长，也不代表提速下载本身。

缓存打开命令没有前端路径参数：读取当前生效缓存配置，用 Tauri opener 在 Finder/文件资源管理器中打开目录。目录不存在则创建；错误在按钮附近展示。浏览器入口禁用，不给前端新增任意目录打开权限。

## 已验证

- CastGlean 宿主 30 项测试、specta 导出通过。新增测试覆盖快照与进度竞争、旧任务/终态迟到消息、历史终态与磁盘盘点、订阅所有权及回收、千条突发合并与 EOF 补发、多文件高水位和 EOF 前的实时更新。
- TaleChime 无模型后端单元 27 项通过，含满队列仍可完成底层操作、失败时只发送真实字节、订阅者消失不取消下载。两个本地 HTTP Hub 集成测试通过，确认下载、修复损坏缓存、落盘和精确完成字节；不用公网或真实模型。
- 两仓相关 Clippy `-D warnings`、fmt 与严格 rustdoc 通过。TypeScript/Vite、Lingui 严格编译通过，中英文新增两条文案，754 条有效文案无缺失。Biome 只保留原有 sidebar cookie 警告。
- macOS 隔离调试包 `com.yexiyue.castglean.model-progress-qa` 的模型中心通过 Channel 显示真实目录；进入设置再返回仍能取得一致目录。
- 实际点击设置中的“打开缓存目录”，Finder 打开 `/Users/yexiyue/.cache/huggingface/hub`，与宿主当前默认共享缓存路径一致。

本次没有主动下载或加载真实模型，也没有独立测量 Windows 真正下载时的端到端延迟；Windows 的进度流畅度和文件资源管理器打开仍待实机确认。既有窗口操作在 Windows 通过的用户反馈，不等同于本次新增进度行为已通过 Windows 验收。

## 真实下载停滞排查与速度显示（2026-11-05）

用户反馈 MOSS Realtime 一直为 0 B 后，针对同一固定权重做了公网对照，未加载模型：

- 文件：`OpenMOSS-Team/MOSS-TTS-Realtime`，revision `75682787d8e2fcc73faca37ba2931453ca9c4022` 的 `model.safetensors`，4,663,931,664 字节；界面的约 11.8 GB 是完整模型资源总量。
- 原始 hf-hub Xet 回调 40 秒一直为零，日志捕获 CDN 的 `tls handshake eof`；真实 `Downloads::ensure` 路径另跑 120 秒仍是零。说明停滞发生在传输层，早于 TaleChime 进度桥和 Channel。证据不能进一步确定是 CDN、代理还是本地链路导致握手失败，也不意味着所有环境的 Xet 都失败。
- 同一权重普通 HTTP Range 收到真实 1 MiB；切换标准 HTTP 后，120 秒收到 6,897,331 字节。再次启动从临时文件继续，累计推进到 58,584,757 字节。诊断缓存使用 `/tmp/castglean-hf-http-probe`；未清理用户原有共享缓存或下载残片。
- 增加默认忽略的宿主公网验收 `real_download_reaches_channel_with_rate_and_eta`：通过实际 Registry → prepare_resources → 宿主聚合 → Tauri Channel 序列化，约 7.7 秒通过，捕获 33,558 字节、正数速率及正数 ETA。测试用独立临时目录，60 秒有界，不加载模型。复现：`cargo test --manifest-path src-tauri/Cargo.toml --lib real_download_reaches_channel_with_rate_and_eta -- --ignored --nocapture`。普通测试不联网。

TaleChime 显式选择标准 HTTP 流式下载，继续由 hf-hub 管理共享缓存、文件锁和快照。上游 Rust 1.0.0 没有单文件禁用 Xet 的 API，本次保留有来源与许可证的本地补丁，见兄弟库 `vendor/hf-hub/SOURCE.md`；没有关闭 TLS 验证。HTTP 支持 Range 续传、服务器忽略 Range 时重新写入、响应状态/范围/长度校验，失败不发布缓存或引擎文件。90 秒没有实际字节增长会返回 Network 失败；重复零回调不延长等待，正常慢速下载只要有增长便可继续。缓存锁等待也受该时间界限约束。

宿主以近期 5 秒字节增量估算速率，至少采样 1 秒；等待响应时间和续传前已有字节不计入速率。5 秒无新数据后显示停滞、撤回 ETA；恢复时重新估算。列表与详情复用同一组件，显示实际字节、当前文件、速率与约计剩余分钟/小时。微小正进度显示 `<0.1%`。ETA 随链路速度变化，只是估算。

验证：宿主 34 项普通测试及上述公网 Channel 验收；TaleChime 29 项单元测试、3 项本地 HTTP 集成测试（含 Xet 元数据、206 续传、200 忽略 Range、错误范围、短响应、403），以及两仓相关 Clippy、fmt、rustdoc、TypeScript/Vite、Lingui 严格编译。新增 8 条中英文文案。没有重新进行原生窗口截图验收，也没有进行 Windows 新版下载实机验收；公网抽样成功不代表完整模型已下载或加载验证通过。
