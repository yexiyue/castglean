# Design

## Context

动机与范围见 [proposal.md](proposal.md)。设计依据为已选[静阅青方案](../../../docs/desktop-studio/design-system-proposal.md)、[Tailwind 实测](../../../docs/research/tailwind-design-system-governance.md)、[表单调研](../../../docs/research/form-components-and-state.md)和[问题清单](../../../docs/ui-ux-audit/README.md)，不是仅凭效果图判断可交付。

已检查的当前实现：

- `src/index.css` 已有亮暗 CSS variables、`@theme inline` 与语义圆角；`components.json` 是 Base UI 的 `base-nova`，Button 已使用 CVA，`src/lib/utils.ts` 导出 cn。
- `ui/field.tsx` 已提供 Field/FieldGroup/FieldSet/说明/错误，是本地组合组件，并非 Base UI Field.Root 的自动校验上下文。应用中仍混用手写 label、NativeSelect、原生 checkbox、独立 useState 和不同提交方式。
- `chapter-pause-editor.tsx` 已在失焦/Enter 调用保存，但无效值只留在通用“未保存”反馈；关闭和目标切换需保护待确认操作与草稿。
- `ImportedWorkspace` 同时持有当前浏览章的 audio status 与 `useChapterPlayer`。后者在 status.run 身份变化和卸载时停止，故切章状态不能继续作为正在播放媒体的唯一有效性来源。
- 新导入与最近工程路由、音色包检查、系统凭据和幂等回执已有宿主语义，不重新在浏览器实现。
- 既有 Biome 2.6.4 支持拟用四条 Tailwind 规则；无分层启用前三条会命中 764 条 info，包含共享原语内部和合法布局，不等于 764 个缺陷。

## Goals / Non-Goals

**Goals:** 全产品表单与状态模式统一；可替换静阅青主题；工具检查可阻止外观绕过；23 项已确认问题有独立回归；用户已确认的跨章播放持续且可控制。

**Non-Goals:** 不另建 schema 驱动表单生成器、全局万能 FormProvider 或第二套组件库；不重写宿主数据校验、不改数据库格式；不为本次工作引入 Motion、React Aria 或虚拟化替换，不把尚未交付的音频重做、整书任务等纳入。

## Decisions

### D1 全覆盖，以编辑语义而非标签扫描决定范围

用户已将“试点”扩展为全产品。所有编辑表单使用同一共享 UI 与 React Hook Form/Zod 接线，简单单字段也不能保留另一套错误、保存和草稿协议；即时字段采用轻量局部表单实例。纯搜索、导航、播放等使用共享原语但不虚构提交 schema。以下为实施清单，不把未知泛化探索留到 apply：

| 区域 | 已定位入口 | 表单/交互责任 |
| --- | --- | --- |
| TXT 导入 | `src/routes/new.tsx` | 工程名、编码、每文件状态；宿主选择和解码，稳定工程路由 |
| 结构与定位 | `projects/structure-actions.tsx`、`chapter-splitting-workbench.tsx`、`heading-rules-editor.tsx`、`split-proposal.tsx`、`chapter-diagnostics.tsx` | 标题、起点、卷、规则、行号/章号、筛选与候选选择；提交前具体上下文 |
| 归属 | `analysis/boundary-editor.tsx`、`analysis/segment-inspector.tsx`、`projects/imported-workspace.tsx` | 边界、归属和就地编辑，人工保护与修订保持 |
| 角色/绑定/设计 | `projects/character-target-detail.tsx`、`character-design-dialog.tsx`、`character-voice-picker.tsx`、`chapter-voice-panel.tsx`、`design-candidates.tsx` | 名称、别名、复用、画像、声音选择与设计草稿；选择/试听/绑定分开 |
| 声音创建与试听 | `voices/voice-studio-page.tsx`、`audition-panel.tsx`、`design-resources.tsx` | 两种创建方式、文本、录音/转写、模型/设备/种子，模式草稿及资源条件 |
| 音色资产 | `voices/library-voice-editor.tsx`、`import-voice-dialog.tsx`、`voice-library-rows.tsx` | 名称/描述、包内字段、冲突和批选；稳定资产身份与文件归属 |
| 连接与设置 | `settings/llm-settings.tsx`、`engine-storage-settings.tsx`、`settings-panel.tsx`、`models/model-select.tsx` | 连接/模型数组、思考与容量字段、存储选择、语言/主题及搜索；凭据特殊语义 |
| 停顿与媒体 | `projects/chapter-pause-editor.tsx`、`chapter-audio-track.tsx`、`waves-cn/wave-player.tsx` | 停顿是编辑表单；缩放/seek/音量是媒体控件，不受普通表单提交生命周期影响 |
| 助手 | `ai-elements/session-input.tsx` | 纯文本、会话草稿、引用、发送及停止；保留组合输入与焦点作用域 |
| 示例 | `workspace/chapter-workspace.tsx` 及 `/project/sample` | 不单独迁移旧模拟表单，改用真实工作台组件的隔离适配 |

共享 `ui/` 中的 input 本身不再嵌套额外 form；通过父实例的 Controller/register 接线。控件范围还包括没有 form 标签的编辑场景，所有清单项在任务与验收中交叉核对。

### D2 RHF + Zod 负责输入，不接管业务权威

新增兼容的稳定版 `react-hook-form`、`@hookform/resolvers`、`zod`；采用当前 shadcn Field 组合，不引入旧的另一套 Form 展示包装。TanStack Form 可完成同类功能，但用户已接受 RHF/Zod 组合，避免再造平行接法。

按实际目标建立局部表单实例，复用字段组合和输入适配，不建立全应用单一表单状态。Zod 校验当前界面输入和跨字段规则；错误用可翻译代码/消息与 Lingui 关联，不能冻结语言。只在明确动作中执行列表获取、连接探测、合成或宿主写入，schema 解析无远程副作用。

RHF 的内部字段数组 key 与宿主模型/角色稳定 ID 分离；生成的 UI key 不作为业务身份提交。受控 Select/Combobox/Number Field 通过 Controller 显式映射；服务回读只对正确目标确认基线，不盲目 reset dirty 字段。已有上层会话/工作区拥有的草稿通过适配读写，RHF 只管理对应输入实例，不能重复建立第二个权威。

保留基本浏览器语义与 required/min/max；其反馈、Zod 与宿主错误合并成一套清楚的字段信息，而非三套重叠错误。

### D3 用有限表单模式统一保存和关闭

| 模式 | 用途 | 规则 |
| --- | --- | --- |
| 显式提交 | 连接、角色资料、音色信息、创建与导入确认 | 明确保存/取消；dirty 不等于已保存，成功按宿主回执；取消只丢弃本实例草稿 |
| 即时单字段 | 当前已有的归属/绑定及停顿等编辑 | 保持所属用例提交时机，停顿按合法 blur/Enter；状态就近展示，关闭等待正在进行的提交，失败/无效草稿保留或明确放弃 |
| 消息动作 | 助手输入 | 发送只是接受消息与任务，不是表单自动保存；父会话保留草稿，重试与停止遵守原任务身份 |

每次写入冻结目标、输入、期望修订和 operation ID。发出后用户切换目标不会让旧回执改写新表单。回执成功与随后读取失败分别显示；未知结果保持原身份核对/重放，不由“重试按钮”生成新身份。密钥保持/替换/移除不折叠为空串，不进本地存储、日志、错误、截图或表单默认值导出。

关闭协议：合法且已触发即时提交时等待确认；失败或非法草稿提供继续编辑/重试或明确放弃，不能直接卸载丢失。多字段表单未保存时关闭保留所属工作区草稿或提供明确放弃路径，不统一强制自动保存所有表单。

### D4 优先现有组件，补齐搜索与数字原语

Field/FieldSet/FieldGroup/Label/Description/Error 管结构；InputGroup 及其子组件管单位和字段内动作；Select/RadioGroup/Switch 管少量选择，Base UI 版 shadcn Combobox 管长集合。保留文件选择的原生宿主行为，不能把路径框当文件授权。

停顿等数字编辑封装 Base UI 1.9 的 Number Field：已核对安装源码，默认会在部分交互中钳制；使用 `allowOutOfRange` 保留直接输入的越界值交给字段校验，步进仍按范围约束。原始空串、格式与数值分开，不直接使用会把空串变 0 的强制转换。验证输入 11、清空、负值、中文组合、按键步进和关闭时序。

Number Field/Slider 的 aria 值、单位、范围、步长和边界索引必须正确；读取中的音色和失败不渲染为空集合。UI 框架不能解决宿主状态与结果确认，故先修共享语义再批量换调用方。

### D5 静阅青保持一份主题事实

`src/index.css` 或其显式导入文件保存亮暗值与语义映射。核心：亮背景 `#F8F9F7`、表面 `#FFFFFF`、正文 `#182C29`、次文 `#536561`、主行动 `#245B50`/白字；暗背景 `#17211F`、表面 `#202D29`、正文 `#EDF2EF`、次文 `#C8D2CE`、主行动 `#A6D3BF`/`#132823`。完整边框、focus、hover、disabled 与各状态色对在组件矩阵中测量，不从生成图采样。

保持现有 shadcn 语义名和圆角角色；本轮初始沿用 10/8/12/16px，控件高度由共享 size 控制，避免未经验证改成图片暗示的尺寸。播放中、生成中、选中、待处理与成功独立表达。保留 Geist/中文回退和 Lucide/正式品牌资产，去除图片生成的渐变、假 logo 和非规格动作。

不新增 token JSON 与 CSS 两份手写真相；未来换色改变全局语义值，页面不硬编码色阶、hex、dark 覆盖或局部 CSS 变量补丁。

### D6 Tailwind 门禁区分定义与调用

在 Biome 配置指向 `src/index.css` 的 stylesheet，保留 cn/CVA 识别。启用 `noTailwindRawColors`、`noTailwindArbitraryValue`、`noTailwindRestyledComponents`、`useTailwindStaticClassStrings` 并最终设为 error；不是新增 ESLint/Prettier。

- 通用 UI 实现层可以定义外观，因此不对它内部套原语的 JSX 一刀切施加 no-restyle；语义颜色、完整类名与登记尺度仍受检查。
- 业务调用方的叶子组件外观通过 variant/size，不随手改 padding、色、字重、圆角、焦点与动效；布局容器如 FieldGroup 的必要 spacing 例外按组件名/类别登记，不允许 `components: "*"` 放开。
- 任意值区分视觉设计和真实几何。已有源码中的合法选择器 variant、动态波形/游标/虚拟坐标不应被误伤；可复用固定布局变命名 token，真正动态值只允许领域必要属性。
- 四条内建规则不覆盖 black/white、原生 DOM 的命名尺度、inline 视觉属性和所有 CSS 绕过。用现有 Biome 插件能力补已确认的窄缺口，覆盖正反例，不自研 Tailwind 全解析器、不全局禁用全部 inline styles。
- 先迁移明确模块，再把对应边界升为 error；交付时全部范围受门禁，不能留下永久全目录忽略或只检查 diff 的债务机制。

样式规则只能证明写法，不证明焦点和业务状态。静态门禁与真实交互验收分别完成。

### D7 Typeset 只承载内容排版

复制并持有官方 Typeset CSS，显式导入，定义命名 `typeset-chat` / `typeset-docs`，size/leading/flow 引用本地排版 token。先核对 Streamdown/MessageResponse 输出与 `.ai-message-response` 原有覆盖、utility 优先级，合并重复规则；工具卡退出内容排版。

小说原文不交给 Markdown。只共享文字 token；字体变化重新测量虚拟高度与锚点。测试流式未闭合代码、列表、表格、中英文长内容和工具卡，避免把文字改善当作控件主题替换。

### D8 浏览状态与播放会话分离

按用户确认，切章继续原章节播放。把播放会话提升到稳定工程/应用播放协调层，冻结 project/chapter/run/arrangement/media identity 及队列，和现有音色播放器共享单音源仲裁。`ImportedWorkspace` 只消费播放投影并发起明确起播/定位动作。

播放有效性针对原播放目标查询，不用新浏览章的空/新 run 快照触发 stop；暂停/seek/时间由媒体驱动，新生成单元不追加已有冻结队列。控制条标原工程/章节，返回定位当前片段；选择或浏览其他章不改变播放目标。关闭所属工程/窗口或显式停止释放会话，音色试听仍先停止章节音源；单元真实失效和失效播放媒体仍按原契约停止。不要把在同一章切换 run 的既有停播测试简单删除，以掩盖导航问题。

### D9 对象化错误与路由恢复

配置入口依据 Base UI 当前激活 API 修复，验证点击及 Enter/Space，不把 `onSelect` 观察当作未经实验证实的唯一根因。失败反馈携带操作类别和安全对象标识：读取、写入、连接、任务恢复、新版本分开，未知提交走原身份。生成阻塞入口定位对应分析/缺声/资源，不自动启动请求。

部分导入成功事实与待处理文件列表分开，保存宿主返回的 project ID，返回章节明确 navigate 到稳定 `/project/:id`，刷新不落回 `/new`。编码样本显示位置、重叠；文件错误显示 basename 与类别，保留已成功来源，重试不重新导入它们。包校验及路径授权仍在宿主。

### D10 复用真实工作台并保持窄窗记忆

示例切为真实工作台呈现的隔离数据端口，静态数据留在示例适配层，不把 mockIPC 放生产真路径；例子持续标识，不支持操作明确反馈。旧独立 `workspace/chapter-workspace.tsx` 在入口切换后移除，不保留兼容工作台；真实工程不读示例状态。

结果页按真实章节能力陈述，不为消除陈旧文案而新增工程级结果系统。1024×680 是当前真实窗口下限；临时目录覆盖辅助区时保存此前的属性/助手类型、对象和焦点，关闭后恢复。固定可发现命名入口替代“只能从叫助手的按钮找回属性”，保留原文空间。

快捷键帮助消费现有键位清单，并保留严格 Control+G 的历史例外、scope 与禁用状态；不手写另一份三项列表。尚未完成的系统 IME 验收记录不因 UI 改造自动勾选。

### D11 与旧规格和变更的关系

当前主规格仍固定图标工程入口，并保留制作结果未交付时的措辞；本变更对应 MODIFIED requirement 明确改为可发现命名入口和真实能力分类，不无声覆盖主规格。

`redesign-production-experience` 中通用设计系统、资源状态/名称、入口及焦点、播放/示例/窄窗等重合工作由本变更承担。旧草案尚未选择的宏观布局和候选依赖不自动执行，不归档或勾选旧任务；后续归档前协调重合 delta，不能再用旧颜色/几何提案覆盖本次已选决定。

`chapter-audio-workbench`、`attribution-review-and-playback` 和 `introduce-hotkeys` 的领域语义保持；本次只补其呈现与所需播放生命周期，不宣称补齐所有旧听感或系统输入法证据。各修订、回执与数据保护以 owning spec 为准。

## Risks / Trade-offs

- [全表单接入导致草稿、校验时机和数组 ID 变化] → 逐实例映射所有者、请求身份与保存模式，角色/模型 ID 独立于 UI key；按表单清单全量验收。
- [主题/控件迁移造成焦点、对比度或交互退化] → 先共享组件状态矩阵，再真实路由；静态图与计算样式、键盘/读屏分别验证。
- [错误地用规则改写合法领域布局] → 正反例探针、分层边界、具体例外与几何回归，不批量 suppress 或 unsafe fix。
- [Typeset 与 Streamdown/原文选择冲突] → 仅内容容器接入，工具卡退出，保留字节/空白/复制测试。
- [播放提升后泄漏或跨工程音源串扰] → 旧目标有效性与单音源仲裁独立测试，显式停止和关闭释放；导航不重建或扩展队列。
- [跨变更重复覆盖] → 上述 owning spec/范围表和问题证据链随迁移更新，旧变更原任务状态不伪造完成。

## Migration Plan

先建立表单正反例、状态契约与样式门禁，再按共享层→各表单族→播放/路由/示例/窄窗迁移。每批删除被替代的手写展示与重复状态，不保留第二套旧表单。保持 IPC 与数据库格式，只有具体缺陷证明需要宿主安全字段时才最小扩展 DTO并通过绑定测试。

回滚以前端/配置提交回退为主，不扫描、迁移或删除用户工程、来源、凭据和音频。新依赖/锁文件与相应调用原子提交。最终同步根 README、品牌/工程文档、知识库、主规格和实际 `DESIGN.md`；不把本规划或生成图片作为已实施系统。

验收以所有表单族和 23 个问题的“复现条件→修改→证据→未验证边界”闭环为准。自动化、隔离 IPC、真实宿主、真实模型与人工听感分开，不为展示效果触发用户真实工程或付费任务。
