# 表单组件与状态方案

日期：2026-11-13。状态：调研建议，尚未安装表单依赖、修改 UI 或确定库选型。归属方案为[静阅青设计系统](../desktop-studio/design-system-proposal.md)。

## 建议与职责

建议先统一现有 shadcn/Base UI 的表单 UI；服务连接等复杂表单可试点 React Hook Form + Zod。组件、表单状态和校验分别负责外观/语义、编辑生命周期、输入规则，不能因为引入校验库就认为视觉已经统一。

| 责任 | 首选方向 | 解决的问题 |
| --- | --- | --- |
| 标签与布局 | 现有 FieldSet / FieldGroup / Field / FieldLabel / FieldDescription / FieldError | 分组、层级、标签与控件关系、帮助和错误的位置 |
| 文本与复合输入 | 现有 Input、Textarea、InputGroup 及其配套子组件 | 地址、密钥、搜索、单位、字段内辅助动作；统一高度、圆角、焦点和禁用状态 |
| 少量固定选择 | 现有 Select / RadioGroup / Switch；NativeSelect 按具体需求保留 | 键盘可达、选中状态和静阅青外观 |
| 大量或需搜索的选择 | 匹配 Base UI 版本的 shadcn Combobox | 模型/音色检索、空结果与明确选择，不用超长原生下拉框或海量同名按钮 |
| 数值编辑 | 评估 Base UI Number Field，复用既有包并封装统一外观 | 停顿等数值的增减、格式、范围、步长和单位；仍须确定非法输入、失焦、关闭和保存行为 |
| 复杂表单状态 | 优先试点 React Hook Form；TanStack Form 为备选 | 字段值、dirty/touched、提交中、字段/表单错误，以及动态模型列表 |
| 输入校验 | Zod 配合受支持的 resolver | 字段与跨字段规则、可本地化错误；Rust 宿主仍是业务校验权威 |

官方 UI 示例：[Field](https://ui.shadcn.com/docs/components/base/field)、[Input Group](https://ui.shadcn.com/docs/components/base/input-group)、[Combobox](https://ui.shadcn.com/docs/components/base/combobox)、[Number Field](https://base-ui.com/react/components/number-field)。这些是不同用途的共享构件，不需要换成另一整套 UI 组件库。

## 当前源码与迁移重点

仓库已有 `src/components/ui/field.tsx` 的完整组合组件和 `@base-ui/react/input` 包装；目前的 shadcn Field 是本地布局/展示组合，并非直接包装 Base UI Field.Root 的验证系统，不能假定它已自动接管错误关联和校验。

`src/components/settings/llm-settings.tsx` 仍有手写 label / space-y、NativeSelect、多组独立 state 与模型数组；`src/components/voices/voice-studio-page.tsx` 也有手写标签和选择器。`src/routes/new.tsx` 已在工程名称处采用 Field。这说明优先工作是复用和调用一致性，不是重新实现已有 Input 或仅替换全站配色。以上是源码观察，尚未做本轮真实页面视觉比较。

表单样式统一为：分组标题→必要说明→字段 label→控件→字段帮助/错误→操作与保存状态。常规表单 label 在上，少量开关可用水平布局；大窗口不把长字段任意分成多列。只在合适的配对短字段上使用两列，窄窗恢复单列。默认/聚焦/错误/只读/禁用/提交中使用共享状态样式，不在调用方加临时 Tailwind 外观覆盖。

## 表单库的选择

[React Hook Form](https://react-hook-form.com/get-started) 管理输入值、校验、错误和提交，可通过 Controller 接受控 UI；[动态字段数组](https://react-hook-form.com/docs/usefieldarray)可用于连接下的模型列表。shadcn 当前提供 [Field + React Hook Form + Zod 示例](https://ui.shadcn.com/docs/forms/react-hook-form)，能沿用已有 UI，而不是引入新的视觉系统。

[TanStack Form 的 shadcn 示例](https://ui.shadcn.com/docs/forms/tanstack-form)同样使用 Field 与 Zod，是类型化受控表单的备选。项目已使用 TanStack Router/Hotkeys 不是必须选同品牌表单库的理由；也没有证据说明现有需求必须更换成 TanStack Form。建议以服务连接试点的数据流、草稿、模型数组与回执处理决定，并只确立一种复杂表单状态方案。

[Zod](https://zod.dev/) 是 schema 校验库，本身不提供控件或排版。官方 Zod 4 已稳定，而当前 shadcn RHF 教程仍说明其示例使用 Zod 3；实施时按实际安装版本核对 resolver 兼容性，不机械复制版本和 API。

## 统一交互契约

- 未交互字段不在首屏整片报红；提交后定位错误字段，之后在失焦或修正时更新反馈。必填说明与阻塞原因直接可见，不只把提交按钮置灰。
- `data-invalid`、`aria-invalid`、label 与说明/错误 id 显式关联；库接线不等于所有辅助技术路径自动通过。
- 多字段设置使用明确保存/取消与 dirty 状态；试探性“获取模型列表”使用当前草稿且不等于保存。不要因请求中就丢弃整个表单上下文。
- 服务器重新读取不直接 reset 掉用户未保存输入；成功保存以宿主回执更新基线，读取失败与写入失败分别表达。未知结果、期望修订和幂等身份沿用已有用例。
- 密钥留空保持原值、显式移除和替换是三种状态；不把凭据写入默认值、日志、预览或校验错误。
- 停顿等即时编辑保持单字段状态机：草稿、校验、保存中、已保存、失败；非法输入和关闭时不静默丢失。数字空串不得在未经规则处理时强制变成 0。
- 类型/schema 只表达界面输入约束，不能取代宿主的范围、模型能力、修订、引用和数据一致性验证。

## 试点与验收

先用服务连接的名称、协议、地址、密钥、动态模型列表验证复杂表单组合；再用停顿数字编辑验证轻量场景。统一 Field、InputGroup 和选择器的静阅青视觉后，在亮暗、中英、窄窗、完整键盘、输入法、失败重试及离开/返回草稿场景验收。

本轮不新增全站 schema 驱动表单引擎，不批量改所有简单编辑，也不把表单库自身的 dirty 状态当作宿主保存成功。实施前将交互变化补到对应 OpenSpec。
