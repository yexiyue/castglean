# Proposal

## Why

TaleChime 当前只提供单音色包读写，CastGlean 导入导出仍为禁用的预览；逐个搬运音色低效，宿主也缺少预览、冲突决策、类型化错误与部分成功报告。需要由基础库提供可复用的批量能力，并在桌面端形成无需加载模型的真实迁移流程。

## What Changes

- **BREAKING**：用统一的多音色 `.voice` 容器与批量传输 API 替换旧单音色包格式及入口；不提供旧格式读取、转换、兼容分支或旧 API 别名。旧文件保持原样，不自动扫描、删除或覆盖。
- 提供多包检查、音色选择、冲突决策、批量导入及选中音色单包导出，单音色操作复用相同实现。
- 将包大小限制、内容校验、稳定身份、重复识别、逐项原子提交、取消及结构化结果放入 TaleChime；不引入 CastGlean 工程、角色或 Tauri 类型。
- CastGlean 宿主管理系统文件对话框、受控文件句柄、后台任务与权威音色库；前端展示真实列表、多选、导入预览、冲突和结果。
- 以抽象、封装、模块化、信息隐藏约束模块与依赖；格式 DTO、ZIP 布局、锁和暂存目录保持私有，应用 IPC 仅导出应用语义类型。
- 修订旧交互文档中“自定义音色归属单一后端”的描述：音色资产跨模型，兼容性在实际使用时检查。

## Capabilities

### New Capabilities

- `voice-asset-transfer`：模型无关音色包、公开批量 API、受限校验、冲突处理、提交与取消结果。
- `voice-library-transfer-ui`：桌面真实音色库、文件选择、批量预览与导出、任务快照和用户反馈。

### Modified Capabilities

无。当前主规格目录没有已登记能力；在进行的 `talechime-engine-integration` 只覆盖模型资源，本变更不接管其未完成验收。

## Impact

- TaleChime 外部依赖仓库 `../talechime`：`talechime-core/src/voices*`、facade `voice_studio.rs` / `lib.rs`、CLI `voices.rs`、模型参考资源适配调用点、公开 API 测试与文档。此处统一描述契约；本次规划文件仅写入 CastGlean。后续需在 TaleChime 自身工程范围交付依赖改动，再接入本地 path 依赖，不以本仓库的 OpenSpec 范围隐式扩大外部写入范围。
- CastGlean：新增独立 `voices` 宿主域，修改 `lib.rs` 装配、生成 bindings、`src/components/voices/` 和查询 hook；复用既有模型目录，不把文件传输塞入 `engine/resources.rs`。
- 更新 README、数据格式与音色交互说明，删除被替代的单音色传输实现及测试，新增正常与异常批量验收。
- 不包含文字设计、参考录音创建、真实重命名/删除、角色绑定持久化、合成试听、整库覆盖恢复、模型缓存搬运、云同步或库发布部署。未接入入口继续明确禁用，不把预览当成真实行为。
