# Tasks

- [x] 1. 生成 elements：components.json 注册 `@assistant-ui` registry；生成 thread 及依赖件（CLI 交互受阻后按 registry 源码落盘）；裁剪 file/image/attachment/voice/dictation/follow-up 死路径；主题 token 化（rounded-surface/bg-muted/30/渐变入 @utility）；biome vendored 豁免与 spread 登记；tsconfig lib 升 ES2022
- [x] 2. tools/：三个委派工具卡（ToolFallback 部件组合 + `part.messages` 子消息流 + 结果引用 parse）+ 子消息渲染器 + AgentResult/interrupt 表单/恢复条迁移；失败工具体隐藏（AgentToolUI stripFailedToolBody）+ 单测锚定
- [x] 3. thread/：AgentWorkspace 薄挂载层（Provider + Thread 槽：ToolFallback/EarlierLoader/Trailing/Composer 隐藏/Welcome 内容化）+ ThreadList adapter（agentSessions 对接，switch/new，引用稳定化修复死循环）+ 消息级结果引用与上下文 chip（快捷入口无 tool call 的结果展示）
- [x] 4. 输入栏：保留 SessionInput（draft 持久化/上下文拼接/disabled 语义所在），迁至 assistant-ui/input/；Thread 内置 composer 以空槽隐藏，后续迁移有槽可走
- [x] 4.1 输入框内 Enter 发送、Shift + Enter 换行并保护输入法组合，模型与思考强度同排。右侧面板支持拖动调宽，分析任务与结果由消息卡承载。
- [x] 5. use-ai-session.ts 职责收缩（删消息双轨透传 chat.messages；threadList 接入 adapters）
- [x] 6. chapter-diagnostics.tsx 适配（welcome 槽承接空态引导；删诊断历史 Dialog）
- [x] 7. 删除旧层：task-index.ts、ai-elements/ 目录（agent-workspace/session-messages/start-recovery 等）、ui/message、ui/bubble、ui/message-scroller；markdown.tsx 保留（子消息渲染复用）；ui/trace 保留（章节分析进度）
- [x] 8. 测试：ai-components 单测重写（SubagentMessages 安全契约 + strip 纯函数）；删除旧 UI 存量 spec（agent-workspace/ag-ui-interrupt/race/consent/send-failure/input-route/reasoning/context-usage 共 9 个）；session-messages spec 重写（useLocalRuntime fixture，vendor 滚动语义：新 run 自动跟随）；unified-workspace/split-recovery/recovery-actions 锚点适配；viewport 补 role="log"；全量 tsc/Biome/build/单测绿
- [ ] 9. 桌面真窗口验收：发送→tool 卡折叠展开→子代理层级→interrupt 表单→ThreadList 切换→历史恢复→停止/重试→亮暗主题、中英文、小窗口（浏览器 fixture 已过 unified-workspace 全链路，真机未验）
- [x] 10. 文档：README 状态、ag-ui-adoption.md 标注实现、knowledge decisions 记录（含后端协议层审视结论）
