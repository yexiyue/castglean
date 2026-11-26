# CastGlean

章节交互简化（2026-11-13）：已接当前章右侧角色归属与声音设置，AI 校验结果直接可用，下拉修改立即保存，失败可重试并沿用宿主撤销；音色搜索/模型筛选、共享资源订阅、停顿失焦或回车保存和底部单一主要播放器已接入。导入改为先选 TXT、文件名预填名称、同屏编码预览后提交。原文、稳定身份、人工保护及历史音频保持；来源范围变化的重分析仍保留独立候选。自动化和原生验证边界见 `openspec/changes/archive/2026-11-19-simplify-chapter-workflow/validation.md`。

面向个人的桌面有声书制作应用：从本地小说原文完成章节分析、角色与音色绑定、顺序生成和试听。模型提出建议，宿主验证结果，用户保留制作决定权。

当前已实现本地工程与来源管理、分章和章节归属分析、声音绑定、整章顺序生成、片段起播与连续播放，以及日志和诊断导出。原文保持不变；章节任务冻结模型与文本语义身份，相同输入和版本才可续跑。归属分析按窗口恢复，分析与预审都完成的窗口可复用。

Kokoro 使用 g2pW 中文多音字预测和英文神经未知词后备。已完成自动化检查、本机真实模型样本及中文原生的导入→分析→整章生成→停顿 WAV 导出样本；**完整原生界面矩阵、人工听感和其他平台验证仍待完成**。正文归属标记、底部片段轨道、独立停顿与 WAV 导出已实现并通过自动化验证。修改归属或音色后的局部重做、同输入重录与版本采用已实现。2026-11-24 用真实 macOS 窗口与 Kokoro 验证了修正、重做、同段对照试听、采用、重启和 WAV 导出。主观听感单列。见[单章验收](openspec/changes/add-chapter-audio-redo-and-adoption/validation.md#macos-原生流程验收2026-11-24)。

正文支持框选原文，为选区选择已有角色或新建角色并保存，可在未配置 AI 时独立使用。多角色生成前检查会列出尚未标注的原文，也可在确认后将本章剩余未标注段设为旁白。分析以发起时的归属修订为基准，后发分析更新人工归属时会在结果中提示，用户可撤回。

## 技术栈

2026-11-21：工程助手的用量面板支持手动压缩，配置模型窗口后接近上限会自动压缩。完整聊天继续可查，摘要随会话保留。[压缩设计](openspec/changes/archive/2026-11-23-compact-assistant-context/design.md)

2026-11-21：数据库版本不兼容时，启动弹窗可选择「备份并重置」，应用归档旧库后重启并打开空工程列表。[数据格式与备份位置](docs/data-format.md#本地数据库)

2026-11-21：宿主使用 Rig 0.47.0。工程助手主运行持久化 AgentRun，进程重启后从已提交的模型轮和工具回执接着执行。专业任务继续走领域恢复。数据库 v12 可从 v11 增量升级。[恢复设计](openspec/changes/archive/2026-11-23-persist-assistant-agent-run/design.md)

2026-11-17：桌面工程助手与专业任务前后端已切换为 AG-UI + assistant-ui，Rust 直接使用 `ag-ui = 0.5.0-alpha.3`，继续使用 Tauri IPC，不保留旧 agent 兼容层；SQLite v9 保留工程和领域结果、隔离旧任务。类型实测与范围见 [调研](docs/research/ag-ui-adoption.md)，实施任务见 [OpenSpec](openspec/changes/rewrite-agent-ag-ui/tasks.md)，自动化、真实模型和原生桌面边界见[验证记录](openspec/changes/rewrite-agent-ag-ui/validation.md)。


- 桌面框架：Tauri 2（系统 WebView + Rust 宿主），选型依据见 [docs/desktop-studio/technology-choice.md](docs/desktop-studio/technology-choice.md)
- 前端：React 19 + TypeScript + Vite，TanStack Router 文件路由；UI 采用 shadcn/ui 源码组件与 Base UI 原语，包管理器 pnpm
- Rust 宿主：`src-tauri`，负责工程持久化与后台任务；选角、声音映射、候选与导出随产品功能落地
- 音色试听播放器采用 WaveSurfer.js 8，UI 参考 waves-cn 并适配现有 shadcn/Base UI；宿主后台提取并缓存波形摘要，音频仍通过受控本地协议播放。章节播放会话独立于浏览章，切章或切换页面继续播放；桌面底部控制条标明播放工程与章节并可返回当前片段。合成路由、浏览器真实 PCM 和 macOS 隔离实例跨章播放检查通过；人工听感与其他平台待验。

已实现（2026-11-21）：章节下一步整合进底部播放栏，根据归属、声音绑定和宿主预检给出可点的操作。切章后可回到原任务。[局部反馈设计](docs/knowledge/decisions/localized-feedback.md)

已实现（2026-11-21）：[对话内章节生成任务卡](openspec/changes/archive/2026-11-23-add-assistant-chapter-audio-cards/proposal.md) 使用 assistant-ui Task Card 显示工程的近期宿主任务、阶段和单元进度，可试听已有音频并返回原章。助手重新打开时按原任务身份读回。

已实现（2026-11-17）：[redesign-agent-workspace](openspec/changes/archive/2026-11-19-redesign-agent-workspace/proposal.md) 已将两个现有助手入口切到共享任务流、整组回答与单一主要输入模式，停止/重试归根任务、结果状态按领域查询；旧逐题表单和重复操作已移除。整章目标推进、通用领域决定与对话内发起生成由 assistant-guided-production 跟踪。选角试听审批和确认采用已接入，macOS 隔离工程通过审批重启、部分批准、目录与设计试听及确认绑定实测。专项故障回归见[选角试听验收记录](openspec/changes/archive/2026-11-19-add-casting-preview-approval/validation.md)。中英亮暗/小窗口自动化与 macOS 隔离公开工程的真实模型、停止、重开回答和审阅往返已验；其他平台、屏幕阅读器和真实 IME 候选窗仍未验，见[验证记录](openspec/changes/archive/2026-11-19-redesign-agent-workspace/validation.md)。

## 开发

```bash
pnpm install        # 安装前端依赖
pnpm desktop:dev    # 桌面开发模式，启用仅本机的 MCP 调试桥
pnpm build          # 前端类型检查与构建
cd src-tauri && cargo check   # 校验 Rust 宿主
```

## 界面预览

开发服务器提供以下可交互的前端设计预览，设计稿见 [docs/design.figcraft](docs/design.figcraft)：

集合页（模型、音色）的空态、搜索无结果态与加载态锚定在搜索与筛选控件正下方，同类状态形态一致；未知地址等路由级状态保留应用级导航栏。

- `/`：独立工程首页；应用级侧栏是纯图标栏，顶部 Logo 返回工程首页并显示选中态，名称在悬停或聚焦时给出，设置入口固定在最左侧栏底部；「新建工程」不混入导航，入口为目录上方的工程下拉与首页常驻新建卡，各入口同名。工程以卡片网格展示（书名首字标识块），未完成导入的草案并入网格指向继续导入；工具区提供搜索弹窗；桌面端无示例工程入口（浏览器预览的独立示例保留）。桌面端本地没有任何工程时，首页出现一次性首启引导，只把用户带到「看到章节列表」这一步，可随时跳过，跳过后不再自动出现。模型资源从侧栏底部模型状态入口进入，浏览器显示“浏览器预览”。
- `/new`：导入 TXT，选择整本自动分章或每文件一章，检查编码预览并确认；桌面端支持把 TXT 拖入窗口任意位置导入（拖入全窗口高亮提示，非 TXT 明确报错，校验与文件对话框同一条宿主链路）；追加来源时保留已成功项和失败文件，返回稳定的工程章节地址。
- `/project/sample`：复用真实章节工作台的只读示例，可浏览两章；分析、角色编辑、声音与导出需使用真实工程。
- `/project/:id`：单一章节工作台，左侧是与应用级一致的纯图标工程侧栏、虚拟目录/正文、分章结构编辑与归属检查共用布局。工程角色入口为角色中心页面（非弹窗，master-detail）：左列旁白/角色列表（保留 AI 来源）（绑定状态摘要、待审建议标记与搜索），右列所选目标详情集中承载角色身份操作（重命名/别名/复用）、声音绑定（旁白与角色到库音色或预置音色，试听走真实音频链路）、声音画像（人工编辑不被建议覆盖）、选角建议按目标对照（当前绑定与建议并排，逐项采用；显式忽略待补）与音色设计（可预填画像，候选在本目标详情内预选绑定回填）；表单与统计就近渲染，不再有页面级游离表单。AI 选角从工程会话输入栏发起（可携带自定义要求，要求随触发消息冻结并转发给选角子 Agent），结果卡「审阅选角建议」直达首个待审目标。只有一个工程 AI 助手；检查分章、分析本章、选角和自然语言工具请求共用会话、模型、用量及草稿，切章不换会话。每次运行固定目标，迟到结果可定位回原章；会话历史只显示工程助手会话。结构候选和归属重分析继续显式审阅，角色与人工保护、采用/撤回保持；底部「生成本章音频」可对已分析、已绑定声音的章节发起整章生成，正文保留原稿排版，可显示角色标记，片段试听和修改从浮条进入。选区可引用或按起始行分章，行号也可打开分章和合并入口；底栏按当前章状态提供制作主操作。阻塞时从「生成前检查」居中弹窗定位原文、修正归属或就地补音色；本章音频设置另用弹窗，右栏提供 AI 助手和片段属性。底部制作区承载真实单元进度、片段试听、停顿编辑和 WAV 导出，macOS 单章样本已验。范围及本轮验证见[融合验收](docs/desktop-studio/project-assistant-validation.md)，此前归属原生公开样本见[归属验证](docs/desktop-studio/chapter-analysis-validation.md)。
- `/models`：独立模型中心，展示当前构建实际编译的本地模型与离线盘点状态（未下载/部分就绪/已就绪/下载中/失败），支持准备计划确认、分阶段进度、取消/重试及加载验证；各模型通过固定清单直接盘点和读取共享 Hugging Face 缓存。共享缓存可能被其他应用引用，本次不提供模型文件删除。
- `/voices`：我的音色从 Rust 宿主读取真实资产，支持一次选择多个 `.voice` 包、完整校验、逐项选择与冲突决定、批量导入，以及多个音色导出到一个包；进度和结果可在切页后从任务快照恢复。音色存于应用数据目录 `voices-v2/`，不依赖模型下载或服务连接。预置音色来自实际模型目录，不可作为参考资产导出；真实资产已接重命名、确认删除、原始参考与指定模型试听；播放、推理及传输占用时删除返回忙状态。音色列表为分页表格：容器内滚动、行数可选、筛选变化自动回到第一页，整行可点；表头在容器内粘附且为滚动留出余量，表格区保留最小高度，同页任务结果面板不会把首行挤到表头之下。
- 音色详情以真实绑定数据展示工程引用（工程名与旁白/角色目标，可定位到对应工程的角色中心），无引用时如实显示为空。入库要求描述：设计路径自动带出、导入无描述项须逐项补填否则不发布；描述可修改，身份与引用它的绑定不变。删除被工程引用的音色会被拒绝并列出引用清单。
- `/voices/new`：文字设计与参考录音两种创建方式分别使用真实设计引擎和用户 WAV；参考录音与准确转写可在不加载模型时保存。支持会话草稿、旧候选保留及常驻试听播放器；现已接入真实设计引擎、WAV 候选、试听和确认入库（描述必填）；候选切页保留，未保存候选不承诺跨重启恢复。
- `/settings`：由最左侧栏底部齿轮进入，双栏布局——左侧可搜索的分类导航（通用、服务连接、存储位置、语言、快捷键、使用指南、关于），右侧为分组设置项；主题与语言在此调整，服务连接提供文本模型的真实地址和凭据配置，远程语音服务尚未接入，模型资源在模型中心管理。`/settings?section=storage` 可直达分区，未知分区回落到“通用”；分区切换替换当前历史记录，顶栏返回回到原页面，直接打开时回到首页。设置面板在当前会话内常驻，保留未提交草稿、凭据输入和待确认保存。
- 应用界面使用 shadcn Base Nova + Neutral；助手样式取自 assistant-ui Base UI registry。视觉基线、来源和验证见[重置记录](docs/knowledge/decisions/default-ui-baseline.md)。

工程下拉位于左侧目录上方，首页也可从内容区打开已打开的工程列表；模型状态只报告本机真实资源盘点，不隐含文本模型的默认选择。真实工程在统一外壳内采用可收放的目录、章内原文和工程助手三栏。目录行提供章节编辑菜单，搜索可查找本地工程或跳到当前工程的章节，待检查项在独立弹窗中定位。右侧助手与检查器可拖动调宽，助手输入框按 Enter 发送、Shift + Enter 换行，模型与思考强度同排。角色由稳定入口管理；真实工程已支持声音绑定，章节音频第一阶段已实现但原生窗口验收未完成；独立示例不作为真实制作结果。关闭标签只收起视图，标签和阅读位置是界面会话状态；工程、分析、角色、人工修正与 AI 历史由宿主持久化，重开可恢复。

示例页面使用隔离的只读数据，不写入真实工程。整书导入与辅助分章已完成本机验收：桌面宿主冻结 TXT 来源、确认 UTF-8/GB18030/GBK 编码、本地 regex 检测并支持人工标题/起点/分卷调整；不依赖 LLM 或 TTS 准备。浏览器仅提供示例预览；真实工程的打开、校验、读取和保存均由桌面宿主处理。旧版 v1 不再支持，原文件保持不变。

服务连接设置已加入多连接/多模型、系统凭据、默认与任务模型选择、分项能力探测，本地服务也可显式获取模型列表。 新建或编辑时可使用当前地址与凭据获取模型列表，无需先保存；部分服务返回的容量显示在列表中，输出能力上限不会自动设为请求参数。 OpenAI 兼容网关返回的可编码思考档位随模型记录，重新获取会更新已有模型；ultra 暂不支持。分章诊断通过 Rig 工具循环提出规则和行补丁，宿主状态机管理外层检查点，正式采用须点击确认。宿主测试、bindings、前端构建、真实桌面主链、故障恢复及 128 MiB／10000 章容量往返已通过；指定 Magpie 网关的 OpenAI、Anthropic、Gemini 三协议均完成列表、文本、工具、Schema 与流式验证。**其他平台、原生厂商端点和发布包性能仍需分别验收，尚未发布**，见[分章验证记录](docs/desktop-studio/chapter-splitting-validation.md)。

本地工程在 SQLite 中保存目录与编辑状态，原始字节和精确 UTF-8 正文单独按摘要保存。提交成功后自动保存，工程通过本地 id 打开；不读取或迁移旧 `.castglean` 文件及恢复目录。来源范围与限额见[数据格式](docs/data-format.md#本地工程与来源)。音色设计、原始参考与模型试听已接宿主，独立验收边界见音色验证记录。章节音频第一阶段（整章生成与播放）已在 macOS 单章样本实测；远程语音服务和系统通知仍待接入。修改归属或音色后的局部重做、重录与版本采用见[单章收尾变更](openspec/changes/add-chapter-audio-redo-and-adoption/tasks.md)。底部轨道、归属范围及停顿导出进展见 [章节音频工作台](openspec/changes/chapter-audio-workbench/tasks.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/desktop-studio/README.md](docs/desktop-studio/README.md) | 桌面有声书工作台企划 |
| [docs/desktop-studio/execution-and-roadmap.md](docs/desktop-studio/execution-and-roadmap.md) | 执行与路线图 |
| [docs/data-format.md](docs/data-format.md) | 数据格式约定 |
| [docs/knowledge/README.md](docs/knowledge/README.md) | 阶段规划、技术决策和可复用的踩坑记录 |
| [docs/brand.md](docs/brand.md) | 品牌规范 |

现行架构与功能契约以工程约定和 OpenSpec 主规格为准。架构诊断重构的逐项处置及复测结果见 [Archify 验收记录](openspec/changes/archive/2026-11-26-resolve-architecture-findings/validation.md)。

前端逻辑测试使用 Vitest，浏览器测试使用 Playwright Test 并按功能分组。执行方式与原生验收边界见[工程文档](docs/engineering.md)。

## 路线图

2026-11-07 本地 AI 任务运行时重构：数据库工程、不可变来源、通用会话、Apalis 调度和 graph-flow 检查点已接入；当时主界面使用新 IPC 与 AI SDK 共享 transport（2026-11-17 已由 AG-UI 替代）。旧 Recovery、便携工程打开/保存和分章专用诊断协议已移除，既有用户文件不扫描、不导入、不删除。Windows 真实桌面已验证导入、后台执行、历史恢复、候选采用、明确重试、正常重启、长历史分页、双会话及最小窗口的中英文亮暗主题；协议使用本机可控夹具，不代表真实模型质量或其他平台验收。完整检查通过：184 项宿主库测试、2 项集成测试、12 项 AI 测试和 9 项播放测试；6 项外部条件测试按原配置忽略。进度见[任务清单](openspec/specs/background-ai-execution/spec.md)，证据见[存储重构验证记录](docs/knowledge/lessons/local-storage-windows-validation.md)。

- [x] 仓库在 Tauri 2 脚手架上重启，品牌与文档迁移完成
- [x] 引擎接入层（B1）：TaleChime path 依赖、hf-hub 共享缓存下载、模型中心真实化
- [x] 整书 TXT 导入、人工分章与可选 LLM 诊断（本机验收；章节归属由下项独立交付）
- [x] 章节角色与归属分析：首次初稿、旁白/台词/内心独白、原文证据、稳定角色与人工保护、重分析候选/采用/撤回；210 项 Rust 测试、浏览器及真实 macOS/GLM 公开样本闭环通过，语义错误和平台边界见[验收](docs/desktop-studio/chapter-analysis-validation.md)。
- [x] 全站视觉体系重设计（`redesign-visual-system`：统一 token/排版/状态语言/空状态，移除开发预览页；浏览器截图亮暗×中英验收、biome/tsc/22 项 node 测试与桌面构建启动通过）。其视觉规范已被 2026-11-18 的官方视觉基线取代，未执行的桌面核验不再适用，变更按已替代归档，见[替代说明](openspec/changes/archive/2026-11-23-redesign-visual-system/tasks.md)
- [x] 统一表单接线与交互一致性（`unify-forms-theme-and-interactions`）：表单按显式提交、即时编辑、消息三种方式接线，共享 Combobox 与 Number Field 封装，导入、结构、归属、绑定、音色与设置表单迁移，跨章播放会话与唯一控制条，读取重试与任务重试区分，样式边界检查（Biome 两条 Tailwind 规则与 `scripts/check-visual-boundaries.mjs`）。自动化证据见该变更的 validation.md；其静阅青视觉部分已被官方视觉基线取代，2026-11-23 对账后仍开放 `manual-attribution-dialog` 统一接线与真实窗口、读屏、系统输入法验收
- [x] 分章工作台前端重写：目录/原文/助手联动、结构差异、整套方案审阅、历史与输入体验；17 项 AI/分章测试、9 项播放测试及浏览器隔离 IPC 亮暗×中英回归通过，真实 macOS 构建启动通过，原生桌面交互未验证，见[验证记录](docs/knowledge/lessons/chapter-splitting-workbench.md)。
- [x] 全应用界面一致性：统一 10/8/12/16px 控件/列表/面板/弹窗圆角，清除式搜索、音色创建高级选项和设置减负；128 组小窗口中英亮暗/浏览器与合成桌面检查通过，真实原生交互另行验收，见[实现与验证](docs/knowledge/decisions/desktop-interface-consistency.md)。
- [x] 桌面流程与布局减负：上下文栏替代标题说明式页头，分类/操作集中、模型整行入口、连续创建/选择 TXT、紧凑音色表单与候选分区；浏览器回归通过，原生桌面另行验收，见[调研与验证](docs/knowledge/decisions/desktop-workflow-layout.md)。
- [x] 会话模型与上下文：移除正常对话固定输入/输出/累计配额，展示服务商最新请求用量、可选模型窗口及输出参数，支持直接切换下次模型；190 项宿主测试及前端回归通过，见[决定与验证](docs/knowledge/decisions/ai-conversation-controls.md)。
- [x] 统一章节工作台与工程外壳：分章/归属模式、真实角色入口、阅读锚点及草稿保持，浏览器与自动化验证见[交付记录](docs/knowledge/decisions/unified-chapter-workspace.md)；本轮原生桌面未重新验收。
- [x] 声音绑定与 AI 选角建议：角色中心页面、旁白/角色到库与预置音色的显式绑定（期望修订+幂等回执+审计）、声音画像建议层、选角建议专业任务（共享子 Agent + 原子提交工具）、页内设计入库回填、音色描述必填与可维护、跨工程反向引用与删除保护；schema v4、313 项宿主测试、前端构建/Lingui/Biome 通过，见变更 `bind-character-voices`（已归档，桌面人工验收由下方重构条目承接）。
- [x] 角色中心 master-detail 重构与选角会话集成：左列目标列表（绑定摘要/待审标记/候选分组）+ 右列目标详情（身份/绑定/画像/建议对照/设计），目标级表单就近渲染；AI 选角入口统一到会话输入栏（自定义要求随消息冻结并转发选角子 Agent，页面按钮移除），结果卡「审阅选角建议」直达首个待审目标，设计候选预选发起目标；316 项宿主测试、前端构建/Lingui/Biome 通过，macOS 原生与真实模型主链已验，撤回采用/显式忽略仍待补，见[验收](docs/desktop-studio/voice-binding-acceptance-2026-11-10.md)及变更 `restructure-character-center`。
- [x] AI 组件迁移 shadcn AI Elements 形态（`migrate-ai-elements-shadcn`）：AI SDK Elements 已宣布 2026-11 底弃用；新增 `ui/message`、`ui/bubble`、`ui/message-scroller`（基于 `@shadcn/react`），`ai-elements/message.tsx` 三件套删除、Streamdown 渲染器迁为 `components/markdown.tsx`，会话消息线程换 Message Scroller（跟随流式、前置历史不跳动、回到最新），用量进度换 `ui/progress`；行为契约（转义、工具体隐藏、分页）由既有测试锚定，tsc/87 项测试/边界检查通过。该变更落地的三个消息件已由下条 assistant-ui 重写删除，其真实会话验收未执行、由下条变更承接，本变更按已替代归档（见[替代说明](openspec/changes/archive/2026-11-23-migrate-ai-elements-shadcn/tasks.md)）
- [x] Agent 会话区全面 assistant-ui 化（`rebuild-agent-ui-on-assistant-ui`）：删除自建任务树聚合（`task-index.ts`）与 shadcn AI Elements 消息件（`ui/message`、`ui/bubble`、`ui/message-scroller`），消息流改为 assistant-ui registry 生成件（Base UI flavor，文案 i18n 化）+ 三个委派工具卡（折叠行展开子代理嵌套会话与结果引用）；会话切换内嵌 ThreadList；宿主协议层经审视不改。快捷入口结果与上下文 chip 在消息级渲染，失败工具体隐藏保持。tsc/Biome/build/单测绿，浏览器 fixture e2e（unified-workspace 全链路等）通过；原生窗口验收未执行
- [ ] 首个原型：正文阅读区、检查面板与播放器同屏运行并验证流畅性
- [ ] 下一交付：复用已有分析/绑定的整章顺序生成、真实进度、持久音频与连续播放（已实现，自动化与真实引擎宿主层验证通过；原生窗口验收未执行，见[验收](docs/desktop-studio/chapter-audio-validation.md)）
- [x] 章节音频工作台：可直接用单音色朗读整章，也可在完成角色归属和音色绑定后生成多角色音频。正文与右侧面板下方的常驻播放栏支持单章 WAV 导出，片段轨道默认收起并随宽度适配，见[章节音频工作台变更](openspec/changes/refine-chapter-audio-workbench/tasks.md)。
- [x] 全局快捷键统一治理：TanStack Hotkeys 声明式注册（`src/lib/hotkeys.ts` 为唯一键位来源）、弹窗与音频拖拽独占作用域、Cmd+B 双触发消除、输入框焦点与 IME 生命周期防护、显式按键复位；构建与前端回归、macOS 原生面板/弹窗及真实组件合成事件验证见[验收记录](openspec/changes/introduce-hotkeys/validation.md)，系统 IME 物理按键终验另列
- [x] 单章收尾：修改归属或音色后按当前计划重做，只合成输入变化的单元，其余沿用已落盘音频；同输入重录指定单元，结果先待采用；版本可查看、重新采用或放弃，派生版本继承可精确锚定的停顿；WAV 导出只接受当前采用版本。数据库 v13。宿主测试与浏览器回归通过，见[变更](openspec/changes/add-chapter-audio-redo-and-adoption/tasks.md)；真实窗口验收与人工听感留待统一验收
- [ ] 单章收尾后：通过 GitHub Actions 构建首个桌面安装包并发布到 GitHub Release，以下载包完成安装和制作冒烟。[桌面发包路线](docs/desktop-studio/execution-and-roadmap.md#下一阶段github-actions-发首个桌面安装包)
- [ ] 「音频制作」页与多章批量生成同批交付，提供选章、批量检查、持久队列和结果管理。[多章音频制作路线](docs/desktop-studio/execution-and-roadmap.md#音频制作页与多章批量生成)
- [ ] 多章制作之后：桌面迷你播放器，支持播放、暂停与切章。[GitHub Issue #4](https://github.com/yexiyue/castglean/issues/4)
- [x] 助手结果卡就地领域操作（`agent-card-direct-operations`）：统一三段式工具卡（展示行/进度/结果面，结果区折叠态外可见），选角建议卡内逐目标试听与采用绑定/画像（复用角色中心面板）、分章候选卡内整套采用/放弃、归属候选卡内采用/放弃并保留检查器段级修正；全部走既有幂等命令、宿主零改动。浏览器已覆盖归属候选原命令重试、选角进度锚定、选角卡内采用和分章整套采用；桌面真窗口验收待做，见[验证](openspec/changes/agent-card-direct-operations/validation.md)
- [ ] 随后：助手驱动制作复用章节和队列宿主能力，补齐跨步骤目标推进；表达质量与演绎另列

详细规划见 [docs/desktop-studio/execution-and-roadmap.md](docs/desktop-studio/execution-and-roadmap.md)。

桌面窗口已接入平台标题栏：macOS 左侧原生交通灯、Windows 右侧自绘窗口按钮，以及未保存会话/活动任务的统一关闭确认。Windows 原生 Snap 适配已接入，实机行为仍待验收；见[标题栏验收记录](docs/desktop-studio/window-header-validation.md)。

模型下载进度使用有序 Tauri Channel 与重连快照，约 100ms 合并最新字节进度，展示实测速率、剩余时间估算与停滞提示；下载默认优先 Xet，不可用时从有效断点回退 HTTP，支持暂停/继续、重启后的手动恢复、范围并发调度与网络读超时；缓存设置与下载确认可在系统文件管理器中打开当前缓存目录。见[验证记录](docs/desktop-studio/model-progress-validation.md)。

模型下载任务、分片策略与验收边界见[下载任务设计](docs/desktop-studio/download-task-design.md)。

音色中心新增七类语音后端与四类设计适配的真实目录，macOS 编译 CPU＋Metal；编译覆盖不等于各模型实测通过。候选生成、确认入库、原始参考与模型试听的边界及验收见[音色中心验证](docs/desktop-studio/voice-center-validation.md)。

2026-11-05 原生成品准备工作区验证：三类模型及 Kokoro 两变体的 8 个 CPU/Metal 组合均生成有效 WAV，Kokoro 的桌面确认→准备→就绪→波形试听已验证。人工听感、CosyVoice3 旧数值门禁差异与 `complete-voice-center` 剩余验收仍单独保留，见[验收记录](docs/desktop-studio/voice-center-validation.md)。本轮未发布 SDK/应用版本。
