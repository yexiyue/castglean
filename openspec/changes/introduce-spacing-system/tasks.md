# Tasks

## 1. 结构与定点修复

- [x] 1.1 `src/index.css`：`--app-header-height` 3rem → 2.75rem；验证：渲染量测侧栏品牌区与顶栏同为 44px 高（已完成，浏览器预览实测）
- [x] 1.2 `desktop-shell.tsx`：Home 与新建按钮水平边距统一 `mx-2`；验证：顶栏左右控件与标签间距一致
- [x] 1.3 `imported-workspace.tsx`：fallback header `h-10` → `h-11`；底部容器内嵌告警条去掉 `px-3` 与 `border-b`；验证：浏览器开发预览 fallback header 与桌面模式同高，底部告警无双层内边距
- [x] 1.4 渲染核对 `mt-0.5`/`gap-0.5` 等 0.5 档共 13 处：能删则删、光学对齐需要保留的归 `1`；验证：逐处前后对比，无对齐退化

## 2. 半档归位（业务代码）

- [x] 2.1 `voices/voice-library-rows.tsx`（5 处）与 `voices/` 其余 3 个文件；验证：音色库列表节奏与行高不变
- [x] 2.2 `settings/about-settings.tsx`、`settings/llm-settings.tsx`；验证：设置页表单组间距符合角色表
- [x] 2.3 `projects/` 6 个文件（casting-suggestion-panel、project-flow-hint、project-card、character-voice-picker、character-target-list、character-target-detail、chapter-directory）；验证：工作台右面板与目录渲染正常
- [x] 2.4 `models/` 3 个文件与 `components/detail-properties.tsx`、`ai-elements/model-picker.tsx`；验证：模型中心列表与详情渲染正常
- [x] 2.5 全量复核：`grep -rE '\b(gap|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr)-[0-9]*\.5\b' src --include="*.tsx"` 排除 `src/components/ui/` 后仅剩 `models/model-logo.tsx` 定义层登记例外（2 处 `p-0.5`）；验证：命令输出仅含该文件

## 3. 文档

- [x] 3.1 `DESIGN.md` Layout 段补档位表、角色映射与组件库例外声明
- [x] 3.2 `docs/engineering.md` 增加间距档位约束条目，指向 DESIGN.md
- [x] 3.3 `docs/knowledge/decisions/` 新增间距体系决策记录（相对差距阶梯、密度轴分离、44 vs 48 推导），更新知识库索引

## 4. 验证

- [x] 4.1 门禁：`pnpm build`、`pnpm lint`、85 项 Vitest（含 Tailwind/视觉边界）通过；当前 103 项 Playwright 用例均在分批执行和定向复验中取得通过。初始失败包含旧设置/组件路径、旧几何和动效断言、热更新干扰以及已修复的焦点问题，原始失败不抹除；本次不将自动化结果等同真实桌面验收。
- [ ] 4.2 桌面目验：1024×680 最小窗口、中英文、亮暗主题过工作台 + 模型 + 音色 + 设置；重点核对头部带同高、面板节奏、无换行溢出回归；浏览器预览已验：44/44 头部带、按钮边距统一、暗色最小窗口无横向溢出、主区无业务 6/10px 间距（3 处命中均为 ui/ 库内部）；英文与真实桌面验收待 macOS 实操记录
