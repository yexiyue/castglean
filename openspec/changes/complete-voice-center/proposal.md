# Proposal

## Why

模型资源与音色包搬运已经真实化，但用户仍不能在桌面应用中设计声音、用自己的文字试听并确认入库。需要扩展现有 TaleChime 接入，形成独立音色中心的可用闭环，为后续章节选声提供真实资产和试听依据。

## What Changes

- 接入 TaleChime 已有七类语音后端：MOSS、Kokoro、Qwen、IndexTTS、CosyVoice3、VoxCPM、OmniVoice；模型变体由编译后的真实目录枚举。首个实测目标为 macOS CPU＋Metal，明确展示设备不可用、本地转换要求和未验收组合。
- 独立呈现设计引擎目录、输入限制、设备与额外资源；覆盖现有 Qwen、MOSS、VoxCPM、OmniVoice 设计适配，不将专用设计权重当作可选朗读模型。
- 接通文字设计、参考 WAV 与准确转写创建；先生成受控候选，支持试听、重新生成、放弃，用户确认后才加入正式音色库。
- 接通真实预置声音目录、已有资产原始参考播放、选择兼容合成模型与自定义文字的合成试听，以及真实重命名、删除。
- 为设计与试听提供后台任务、协作取消、序号事件与重连快照；复用既有运行时、模型下载和音色库，不用音频 JSON 承载整份 WAV。
- 延续 `talechime/voice/2` 与 `talechime/voice-bundle/2`，保持模型无关资产与后端声音身份分离；正式音色继续支持已有批量导入导出。
- 更新页面、路线图、格式与实测记录，分开记录编译覆盖、资源就绪、推理通过和听感验收。

## Capabilities

### New Capabilities

- `speech-model-availability`：完整语音后端与独立设计引擎的真实目录、设备、资源准备和可用性。
- `voice-creation`：文字设计与参考录音的候选生命周期、试听前预览与显式提交入库。
- `voice-audition`：真实预置目录、参考播放、指定模型合成试听、任务和受控音频访问。
- `voice-library-management`：真实资产重命名、删除及与导出和活动任务的一致性。

### Modified Capabilities

无。主规格库存当前为空。既有 `model-resources`、`voice-asset-transfer` 与 `voice-library-transfer-ui` 位于未归档变更，本变更新增其上层行为，不复制或改写既有传输/下载契约，不代替 `talechime-engine-integration` 的三项未完成验收。

## Impact

- CastGlean：`src-tauri/Cargo.toml`、`engine`、`voices`、IPC 装配与生成 bindings，模型中心、音色中心、创建页、详情、查询 hook 和 Lingui 文案。
- TaleChime 外部依赖：预计扩展 `voice_studio.rs` 的无提交设计候选 API，以及必要的设计资源准备和显式下载设置注入接口；复用 `Engine` 的合成与关闭契约。本次规划仅写入 CastGlean；后续外部依赖改动须在 TaleChime 自身工程范围交付并验证，不由本仓库规划隐式授权外部写入。
- 不涉及章节合成、角色绑定持久化、小说分析模型、ASR 自动转写、录音采集、云端后端、CUDA 首轮实测、安装包发布或跨平台通过声明。参考录音输入先支持已有 WAV，转写由用户提供。
