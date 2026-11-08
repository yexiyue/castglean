# 整本 TXT 导入与辅助分章

## Why

当前导入将每个 UTF-8 TXT 当作一章，工程最多 50 章，无法直接处理整本小说；文本服务设置也只是禁用预览。以整书分章作为首个真实用例，先完成 LLM 设置，再验证 Rig 工具调用、graph-flow 暂停恢复与可检查的诊断交互。

## What Changes

- 完成多个命名 LLM 连接，每个连接配置多个模型；支持 OpenAI 兼容、Anthropic 原生与 Gemini 原生协议，手动填写模型 ID 和按需获取远程列表。
- 密钥存入系统凭据库，允许本地服务不填密钥；连接、工具调用、结构化输出分别进行显式测试，并使配置变更后的测试结果过期。
- 提供全局默认模型及任务覆盖，运行固定配置身份；失败不自动切换服务。
- 支持整本 TXT 导入、UTF-8 与 GB18030/GBK 解码预览、本地规则检测、卷章识别、异常提示、目录预览与人工边界调整；不依赖 LLM 才能导入。
- **BREAKING**：新增 `.castglean` v2 来源快照与章节范围格式，替代每章复制全文的写入方式并调整整书容量限制。按用户最新决定，不保留 v1 读取与转换兼容层；旧文件仅报告不支持，保持原文件不变。
- 用户主动启动分章诊断；助手可提出正则规则和具体边界补丁，按需检索全书、读取受限局部上下文，所有方案先通过宿主校验并展示差异，再由用户采用。
- 使用 graph-flow 管理诊断步骤、分支和等待输入，Rig 管模型及受限工具循环；通过 Tauri Channel、自定义 AI SDK UI transport 和 AI Elements 呈现诊断。无需 Node 或本地 HTTP 服务。
- 本地持久化导入草案、人工调整、诊断对话和已完成步骤；重启后等待用户继续，保留中断事实、配置身份与累计预算。
- 本轮不实现 EPUB、章节角色分析、朗读规划、TTS 切段、音频制作、多 agent、公共图编辑器或通用工作流引擎；后续章节分析可使用 Rig 单次结构化调用和程序校验。

## Capabilities

### New Capabilities

- `llm-connections`：LLM 连接、模型、凭据、能力测试与任务配置选择。
- `novel-chapter-import`：整书来源快照、编码确认、本地分章、人工修正与工程保存。
- `chapter-splitting-diagnostics`：受限工具诊断、方案确认、图执行与跨重启恢复。

### Modified Capabilities

无。现有三个主规格均属于语音资源和音色搬运，不改变它们的协议或验收边界。

## Impact

- Rust：在 `src-tauri` 单 crate 内新增私有 LLM 与导入/诊断模块；扩展 `project/{document,commands}.rs`、IPC 装配和统一关闭提示，复用宿主运行时，不占用 TaleChime owner 线程。
- 前端：替换 `settings-panel.tsx` 的文本服务预览；调整 `/new`、工程文件适配、原文工作台与草案状态，新增目录差异及诊断面板；使用现有 Base UI 主题与 Lingui。
- 依赖：Rig、graph-flow（关闭默认 PostgreSQL）、系统凭据库适配、编码与有界正则处理、AI SDK UI/AI Elements；锁定实际兼容版本并验证传输契约。
- 数据：版本化 LLM 非密钥配置、本地恢复日志、`.castglean` v2；工程与诊断不包含凭据，不自动迁移、删除用户文件。文档和路线图随实现更新。
