# 表单入口核对（2026-11-14）

本表根据 D1 清单、当前源码与已有测试整理；浏览器测试使用合成 IPC。源码接线或测试存在不代表所有状态、真实宿主与辅助技术已验收。完整证据和未完成边界见 [validation.md](validation.md)。

| 区域与入口 | 当前接线或分类 | 代表性验证 | 尚需证据 |
| --- | --- | --- | --- |
| 导入 `routes/new.tsx` | 工程和逐文件数据使用局部 RHF；选择与解码由宿主负责 | `batch-import-recovery-browser.mjs`、`import-preview-browser.mjs` | 真实系统选择器与部分失败闭环 |
| 结构 `structure-actions`、`heading-rules-editor` | 标题、卷、定位、规则使用局部 RHF；规则数组有独立 UI key | 实际路由 `structure-actions-browser.mjs`、共享组件 `heading-rules-browser.mjs` | 真实宿主键盘和窗口验收；旧独立工作台仍待清理 |
| 分章候选与诊断 `split-proposal`、`chapter-diagnostics` | 候选勾选/筛选是选择，诊断配置和消息使用局部表单；确认由宿主动作处理 | `split-confirm-browser.mjs`、`session-input-route-browser.mjs` | 系统输入法、读屏 |
| 归属 `boundary-editor`、`segment-inspector`、`candidate-review` | 边界、即时片段编辑、候选差异选择使用局部 RHF；写入身份由工作区登记 | `boundary-recovery-browser.mjs`、`segment-recovery-browser.mjs`、`candidate-recovery-browser.mjs` | 真实故障注入及窗口验收 |
| 角色 `character-target-detail`、`character-alias-form`、`character-design-dialog`、`design-candidates` | 身份、画像、别名、设计和候选目标使用局部表单；角色选择与声音筛选为导航/过滤 | `character-alias-draft-browser.mjs`、`profile-recovery-browser.mjs`、`character-design-browser.mjs` | 真实任务和原生窗口验收 |
| 声音绑定 `character-voice-picker`、`chapter-voice-panel` | 筛选、目标和试听候选是提交前选择；显式绑定由宿主及操作登记负责 | `chapter-voice-picker-browser.mjs`、`binding-route-recovery-browser.mjs` | 真实读取故障与读屏 |
| 创建与试听 `voice-studio-page`、`audition-panel`、`design-resources` | 输入使用局部 RHF；模式、设备和资源可用性由业务状态控制 | `design-form-browser.mjs`、`audition-form-browser.mjs`、`design-recovery-browser.mjs` | 真实录音选择器、模型和听感 |
| 音色资产 `library-voice-editor`、`import-voice-dialog`、`voice-library-rows` | 名称、描述和导入决定使用局部表单，导入草稿及决策由 Zod 校验；批选为集合选择 | `voice-name-form-browser.mjs`、`voice-import-form-browser.mjs`、`voice-import-recovery-browser.mjs` | 真实文件选择、损坏包重检及读屏 |
| 连接与设置 `llm-settings`、`engine-storage-settings`、`settings-panel`、`model-select` | 连接、模型数组及存储参数使用局部表单；语言、主题和搜索为即时设置/过滤 | `llm-model-array-browser.mjs`、`llm-credentials-browser.mjs`、`engine-storage-form-browser.mjs` | 原生窗口、完整状态矩阵 |
| 停顿和媒体 `chapter-pause-editor`、`chapter-audio-track`、`wave-player` | 停顿是局部表单；播放、seek、音量和缩放是媒体控件 | `pause-form-browser.mjs`、`pause-recovery-browser.mjs`、`wave-player-slider-browser.mjs` | 真实媒体及辅助技术验收 |
| 助手 `session-input` | 局部 RHF 管输入，父会话持有草稿；启动请求有待确认登记 | `session-input-route-browser.mjs`、`hotkeys-browser.mjs`、`assistant-send-session-race-browser.mjs` | 真实服务故障、系统输入法和重启边界 |
| 示例 `workspace/reader`、`sample-reader` | 只读适配复用工作台，不提供写入表单 | `sample-workspace-browser.mjs` | 不替代真实工程验收 |

此外逐项检查 `onChange`、`onValueChange` 与 `onCheckedChange` 调用：搜索、列表视图、章节目录、资源过滤、模型选择、目标导航和媒体控制不引入虚构的提交 schema；需明确提交的编辑仍归所属表单或操作登记。`ui/` 文件为原语定义，不能按调用层直接判定。仍须检查未由这些静态锚点发现的编辑入口，并完成全范围样式门禁，11.1 保持未完成。
