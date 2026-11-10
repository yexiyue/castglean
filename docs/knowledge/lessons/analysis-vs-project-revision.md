# 两个修订计数器不可互传（分析修订 ≠ 工程修订）

日期：2026-11-10 · 适用：角色中心/绑定命令链 · 状态：已修复并验证（tsc/构建/宿主测试）

## 触发条件

角色中心对绑定/画像/采用命令（`voice_binding_edit`、`voice_binding_profile_set`、`voice_binding_adopt_*`）传期望修订时，误传了**分析修订**（`useChapterAnalysis` 的 `snapshot.revision`）。宿主侧这些命令比对的是 `project::store::lock()` 返回的**工程修订**（`project.revision`，由结构编辑推进），两者是完全独立的计数器。

## 症状与危险点

- 无编译期或运行期类型区分，只有宿主返回 `Conflict`——前端表现为「操作未保存，请刷新后重试」，很难从 UI 定位根因。
- 数值偶尔相等时（新工程早期）命令成功，造成「有时好有时坏」的假象。
- 该 bug 在 `bind-character-voices` 首版 UI 就存在，重构 `restructure-character-center` 时核查命令契约才暴露。

## 处理方式

- 角色中心同时接收 `revision`（分析修订，仅身份命令如复用的 `expected_analysis_revision`）与 `projectRevision`（工程修订，绑定/画像/采用），props 带注释说明分工；来源分别为 `snapshot?.revision` 与 `project.revision`（后者由工作台的 `changed()`/快照刷新保持新鲜）。
- 经验：给前端命令封装传修订时，先到 `src-tauri` 命令定义确认它锁哪张表的修订；分析域命令与工程域命令的修订来源不同，不要用一个 `revision` 变量两处复用。

## 未验证边界

- 工程修订在前端是否有其他调用点仍传分析修订：本轮已全量 grep 核对角色中心链路，其余调用点（AI 会话 `prepareRevision`、结构编辑）各自正确。
