# 音色中心接入与验证

日期：2026-11-05。变更：`complete-voice-center`。代码接入与真实模型/听感验收分别记录；本记录不表示全部模型已实测通过。

## 边界

- 七类语音后端由宿主 manifest 显式启用，macOS 单独启用 Metal；其他平台不无条件编译 Metal。型号来自 Registry；设计器独立查询，专用设计权重不进入朗读选择器。
- Candle core、nn、transformers、metal-kernels 均使用同一 fork revision `884b359895a16c8fbd3647789b1f7c7974894708`。缺少 metal-kernels patch 会使 IndexTTS Metal 混用两种来源的 Buffer；已在宿主补齐。
- 候选生成、播放和跨兼容模型试听不写正式库。确认保存以预分配 VoiceId 原子提交；相同候选重放返回同一资产。录音创建不加载模型。
- 推理对象留在已有 engine owner 线程；单推理槽也保护模型加载验证。加载阶段取消先等待加载返回，再关闭模型；运行阶段等待流取消与模型关闭。可控任务测试证明清理未完成前不放行下一项，取消不会提交新结果或覆盖旧结果。资源准备与推理通过活动状态协调，当前采用保守互斥，不并行改写相关资源。
- 原始参考与合成试听分别呈现；媒体仅通过 `voice-audio` 协议解析已发放身份，支持 Range。完成 WAV 写入与校验后才发布媒体身份。
- 本轮增加的任务与候选为会话状态；切页可以重连快照，重启不自动续跑推理。资源下载另有持久化记录；旧 B1 未完成的三项实机验收仍在原任务中保留。

## 自动检查

普通测试不下载模型。宿主测试覆盖队列重放、取消终态、候选预算、忙删除/放弃、保存重放与失败、媒体范围处理和现有工程/传输行为；`voice_models` 独立检查七类后端和四类设计器的编译覆盖。

基础库测试使用注入设计器/后端，验证无提交候选、显式准备、缺资源不触发准备、临时参考适配、转写传入和模型缓存身份隔离。`downloads_hf_local` 以本地 HTTP 服务检查下载、断点、镜像回退与跨来源凭据边界。详细执行结果见本记录后续追加。

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib --tests
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm build
pnpm lint
pnpm i18n:extract
pnpm exec lingui compile --strict
```

## 可复现的现有缓存验收

以下命令只盘点或加载已准备权重，不下载新权重；模型、私人音频和输出不进入 Git。

```sh
CASTGLEAN_MODEL_ROOT="$HOME/.cache/huggingface/hub/castglean" cargo test --manifest-path src-tauri/Cargo.toml --test voice_models cached_model_inventory -- --ignored --nocapture
CASTGLEAN_MODEL_ROOT="$HOME/.cache/huggingface/hub/castglean" cargo test --manifest-path src-tauri/Cargo.toml --test voice_models cached_nano_synthesis -- --ignored --nocapture
```

每个模型/设备组合必须分别记录资源、加载、真实推理与听感。缺少本地转换产物时按模型文档准备，再重新盘点；不把空目录视为转换成功。

## 本轮执行结果

- 七类后端及四类设计器离线覆盖测试通过；Mac 可用设备来自实际探测。MOSS Realtime 与专用 MOSS 设计只提供 Metal，本轮未伪造 CPU 回退。
- `cargo tree -p candle-metal-kernels --depth 0` 仅解析到上述固定 fork。首次 debug macOS `.app` 打包成功，约 198.95 MiB；不是 release 体积基线或发布产物。
- TaleChime core 69 项、facade Qwen 组合 12 项、backends 无权重 29 项及本地 HTTP 下载 6 项通过；Clippy/rustdoc 对修改的公开接口通过。
- 真实现有缓存：Nano 为 Ready；Realtime 部分就绪；其他合成/设计组合缺少权重或转换产物。未发起整套权重下载。
- MOSS nano CPU 真实短文本合成通过：`你好。`，53760 样本、560 ms，首次加载及生成约 7.05 s。
- MOSS nano Metal 真实短文本合成通过：`你好。`，76800 样本、800 ms，首次加载及生成约 10.30 s。随机输出不同，不作为 CPU/Metal 性能比较或听感结论。
- 其余模型及四类设计器真实生成与人工听感仍待资源准备。不能据此勾选所有模型/设计验收，也不代替旧 B1 的端点与断网实机验收。

## 桌面原生检查

- 从 debug `.app` 打开真实预置目录，MOSS nano 的短文本生成到达成功终态，音频协议被系统 WebView 播放器成功读取并出现播放、停止、定位控件。
- 原生选择生成的 WAV 与准确文本，候选显示后切到正式库仍为空；返回创建页候选保持。确认保存后正式列表出现，重命名后重启应用名称和身份保持。
- 0.8 秒参考尝试 MOSS 克隆时明确报告 `reference audio must be 1..30 seconds`，保留资产与旧结果，没有替换为预置声音。
- 第二轮系统选择器出现有效 WAV 的 Open 按钮禁用，移除过滤后仍出现，故恢复 WAV 过滤并明确绑定主窗口，继续由宿主严格校验 WAV。较长参考的最终闭环结果单独追加，不将“选中过文件”视为成功。

源码证据为本地工作区，尚未提交或发布：CastGlean 基于 `535bd0396a2fb9136e78b6f5d4f27a335d71fa30`，TaleChime 基于 `4ed0c6bfb77f6d2d3a864d38665539e332854d58`，另加本变更工作区差异。不能将基线 SHA 当作已包含这些改动的提交。

宿主当前自动结果：51 项通过，另有 bindings 导出与完整目录覆盖各 1 项通过；3 项真实网络/缓存测试按显式开关运行。Clippy 以 `-D warnings` 检查，rustdoc 以 `RUSTDOCFLAGS=-D warnings` 检查。前端 lint 仅剩既有 sidebar cookie 提示，英文缺失项为零。后续如有新增测试，以最终结果行更新此处计数。

## 最终矩阵与未结项

| 模型/引擎 | Mac 可用设备 | 资源 | 真实推理 | 听感 |
| --- | --- | --- | --- | --- |
| MOSS nano-candle | CPU、Metal | 已就绪 | 两种设备均通过 | 待人工评估 |
| MOSS realtime-1.7b | Metal | 部分就绪 | 未执行 | 未评估 |
| Kokoro 1.1-zh / g2pW | CPU、Metal | 缺本地转换产物 | 未执行 | 未评估 |
| IndexTTS 2.5 | CPU、Metal | 缺本地转换产物 | 未执行 | 未评估 |
| CosyVoice3 0.5b | CPU、Metal | 缺本地转换产物 | 未执行 | 未评估 |
| Qwen 固定 0.6B / 1.7B | CPU、Metal | 缺权重 | 未执行 | 未评估 |
| Qwen 克隆 0.6B / 1.7B | CPU、Metal | 缺权重 | 未执行 | 未评估 |
| VoxCPM 2B Q8 | CPU、Metal | 缺权重 | 未执行 | 未评估 |
| OmniVoice 0.6B | CPU、Metal | 缺权重 | 未执行 | 未评估 |
| VoxCPM / OmniVoice / Qwen 设计 | CPU、Metal | 缺权重 | 未执行 | 未评估 |
| MOSS 专用设计 | Metal | 缺权重 | 未执行 | 未评估 |

最终复测：移除过滤未解决“有效 WAV 的 Open 按钮禁用”，已恢复过滤并明确指定主窗口，现象仍在。因此原生选择器第二轮回归、较长参考端到端流程与最终播放器回归未计通过；此前成功完成的选择、候选确认保存、重命名与重启保持仍单独保留证据，不用于替代这次失败。

未结项包括原生选择器复现诊断、完整模型/四类设计真实生成及人工听感。没有发布 SDK/应用，没有触发其他平台验收，没有改变旧 B1 未完成项。

最终收尾检查再次通过宿主测试、Clippy、rustdoc、前端构建和 lint。新增取消清理测试计入上述 51 项。取消加载修正通过自动检查，尚未再次做原生交互验收。

OpenSpec 当前为 23/28：3.1、6.1、6.4 的最终原生回归及 7.2、7.3 的完整真实模型/设计闭环保持未完成，未归档变更。

收尾源码重新打包成功：`src-tauri/target/debug/bundle/macos/CastGlean.app`，约 199.07 MiB；仅供本机 debug 复核，不代表发布或完整实机验收。

## 2026-11-05 WaveSurfer 8 试听播放器

按用户决定，仅参考 waves-cn 的 UI 与源码模式，实际依赖采用当前 WaveSurfer.js 8.0.5。共享封装精简为本项目需要的播放状态与官方 Hover 插件生命周期，UI 适配 shadcn/Base UI 与 Lingui。保留 waves-cn MIT 许可和来源说明。

- 宿主 `voice_audio_waveform` 在 blocking pool 提取最多 1024 个显示峰值，按媒体身份缓存；前端收到摘要与时长，不解码完整 WAV，不把文件路径或 PCM 塞进 IPC。原 WAV 仍通过受控 `voice-audio` 协议读取。
- 全局播放器按需加载，支持播放/暂停、从头播放、可拖动波形、悬停时间、可用键盘调整的进度、0.75/1/1.25/1.5/2 倍速、保持音调、音量与静音。切换与停止先暂停并清空媒体元素，再释放对应租约；暂停仍持有租约。
- 播放器实际高度通过 ResizeObserver 给主工作区留出空间。两个真实音色详情抽屉采用非模态、无背景遮罩的检查面板，并在播放器出现时收起底部区域；其他模态确认与导入流程保持原状。
- 最终 macOS debug `.app` 复核：MOSS nano CPU 生成 `你好。` 成功，波形与媒体播放到达结束位置；抽屉打开时可点击全局播放器，选择 1.25× 后选项值正确更新，静音显示切换且音量为 0，进度可调回 0，停止后播放器消失且面板恢复高度。之前一轮 `你好，欢迎收听今天的故事。` 也完成真实生成、波形加载与播放。没有据此声明全部模型或听感通过。
- 宿主 lib 53 项、bindings 导出 1 项、目录编译覆盖 1 项通过，3 项显式缓存/网络测试保持 ignored；新增 2 项波形测试覆盖多声道反相不抵消、输出数量上限、非有限浮点与坏 WAV。`cargo fmt --check`、宿主 Clippy（`-D warnings`）、rustdoc、前端类型构建、lint 和 Lingui 缺失检查通过。仍有既有 sidebar cookie 提示和 sibling TaleChime 的 SafeArchive 未使用警告，本次未修改它们。

最终本地调试包：`src-tauri/target/debug/bundle/macos/CastGlean.app`。本节变更未提交、未发布；不替代前文原生文件选择器、所有模型/设计器、长音频、平台与听感未结项。

### 播放器审查与简化

本轮审查限定上述播放器改动，以会话需求和仓库工程规范分别检查。两轴确认同一个 P2：旧实例的在途 `play()` 拒绝回调未随停止/切换失效，会重新打开错误提示或污染新试听。另补齐旧失败清理在 await 后的请求检查，并保留未确认释放的租约身份，避免 IPC 释放失败后无法再次停止。

播放生命周期提取到纯会话模块 `src/lib/voice-playback.ts`，Provider 只负责快照渲染和布局；移除重复媒体释放步骤，将波形与媒体作为同一份就绪状态。新增 `pnpm test:playback`（Node 24），9 项测试覆盖精确租约/停音顺序、迟到 acquire、迟到波形、旧播放错误、旧失败清理、释放失败重试、卸载前后回调以及非法波形。前端构建、lint 与测试通过；仅保留既有 sidebar cookie 提示。生命周期由可控 mock 证明；不将这些测试写成新增原生听感验收。
