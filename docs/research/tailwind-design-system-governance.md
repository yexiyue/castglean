# Tailwind 设计系统约束调研

日期：2026-11-13。范围：为已选静阅青方向制定实现纪律；调研与本机探针已完成，项目配置及组件尚未变更。视觉与交互方案见[设计系统方案](../desktop-studio/design-system-proposal.md)。

2026-11-14 更新：Biome 已指向主题 CSS，并在全范围将原始色板和动态类名规则设为 error；任意值、组件覆盖及已知绕过仍在迁移，详见[变更验证](../../openspec/changes/unify-forms-theme-and-interactions/validation.md)。以下“当前”描述是调研时的基线。

## 结论与当前基础

推荐沿用 **CSS 语义 token → shadcn/Base UI 共享组件 → CVA 变体 → 业务组合**，并用 Biome 检查越界。Typeset 用于助手与文档内容的排版。单靠 AGENTS、格式化、类名排序或类名合并，不能阻止设计系统被临时样式绕过。

当前仓库已具备大部分基础：

- `components.json`：`base-nova`、Base UI、CSS variables 和 Lucide；不切换到 Radix 版本的组件示例。
- `src/index.css`：`:root` / `.dark` 的同名主题值与 `@theme inline` 映射，现有色彩、圆角、sidebar 和状态 token。
- `src/components/ui/button.tsx`：CVA variant/size；`src/lib/utils.ts` 已导出 `cn` 包，不再增加另一套 clsx/tailwind-merge 工具。
- 锁定环境：Biome 2.6.4、Tailwind 4.3.3、shadcn 4.23.0、Base UI 1.9.0、cn 0.5.1、Streamdown 2.7.1。
- 当前 Biome 只启用 Tailwind 排序、简写、旧工具类三项 warn，尚未启用以下设计约束规则；“lint 通过”不能证明遵守 token 或组件边界。

## 公开方案比较

以下比较的是公开方案的机制与项目适配，不是市场占有率排名。

| 路线 | 能解决什么 | 本项目取舍与来源 |
| --- | --- | --- |
| Tailwind v4 theme + shadcn 语义 CSS variables | 将角色映射为 `bg-primary`、`text-muted-foreground` 等，换主题不逐页改类名 | 首选；已在使用，补齐语义和组件状态即可。[Tailwind theme](https://tailwindcss.com/docs/theme)、[shadcn theming](https://ui.shadcn.com/docs/theming) |
| CVA / 类型化变体 | 将 size、variant 和组合条件收敛成组件 API | 沿用现有 CVA；类型约束参数但不会禁止 `className` 再覆盖，仍需 lint。[CVA](https://cva.style/getting-started/variants/) |
| shadcn Typeset | 集中 HTML/Markdown 的文字节奏，减少每个 heading、段落、列表单独拼工具类 | 用于助手/文档；不负责整套控件外观。[Typeset](https://ui.shadcn.com/docs/typeset) |
| Biome Tailwind 规则 | 在 JSX、cn、CVA 等类名来源检查原始色板、任意值、组件覆盖及动态类名 | 首选现有工具链；规则为 nursery，要用安装版本实测。[Biome Tailwind domain](https://biomejs.dev/linter/domains/) |
| Prettier Tailwind 插件与 better-tailwindcss | 前者整理类名，后者有 ESLint/Oxlint 下的静态规则 | 可作为其他工具链的方案；本项目已有 Biome，不叠加另一套排序器或为此引入 ESLint。[官方排序插件](https://tailwindcss.com/blog/automatic-class-sorting-with-prettier)、[better-tailwindcss](https://github.com/schoero/eslint-plugin-better-tailwindcss) |
| DTCG token 文件 + Style Dictionary | 单一 token 数据导出 CSS、原生平台等多种格式 | 多消费端时有价值；当前先保持 CSS 单一来源，避免为一个 WebView 引入生成流水线。[DTCG](https://www.designtokens.org/tr/2025.10/)、[Style Dictionary](https://styledictionary.org/) |
| Panda CSS strictTokens / recipes | 将样式属性与 token 约束前移到生成和类型系统 | 是更强约束的替代栈，官方 strictTokens 也有属性范围；当前不为解决 Tailwind 纪律改写既有组件系统。[配置](https://panda-css.com/docs/reference/config) |

这是“主题、组件 API、静态检查、真实验收”的组合选择，不是寻找一个包替代全部约束。

## Typeset 的适用边界

Typeset 是项目自己持有的一份 CSS，通过容器及预设启用。size、leading、flow 控制文字节奏；字体和主题来自应用，最大宽度由布局负责。支持针对聊天和文档定义不同预设，内嵌工具卡可退出内容排版。它的流式布局避免让新增内容改变之前块的排版匹配。[官方说明](https://ui.shadcn.com/docs/typeset)

建议后续建立 `typeset-chat` 与 `typeset-docs` 两个集中预设，数值引用项目排版 token。文档允许容器级一次性覆盖，但本项目为了纪律，业务页面不采用随手写 `[--typeset-flow:...]` 的方式，先新增或调整命名预设。

当前助手使用 `MessageResponse` / Streamdown，且存在 `.ai-message-response` heading/table/code 覆盖。Tailwind utility 在 CSS layer 中可能覆盖 Typeset；只包一层 class 并不能证明统一了排版。实施前必须核对实际渲染节点、已有工具类和 CSS 优先级，再决定通过渲染器组件映射或移除重复样式接入。

小说原文不是 Markdown：不能把 `#`、列表符号或原始空白解释为格式，也不能让通用排版破坏虚拟测量、行号、选区和 UTF-8 坐标。原文阅读器只共享底层文字 token；UI label、按钮和输入控件继续由共享组件管理。

## 已安装 Biome 的规则与局限

| 规则 | 有效范围 | 需要知道的缺口 |
| --- | --- | --- |
| `noTailwindRawColors` | 拦 `bg-emerald-600`、带变体与透明度的原始色板类 | JS 规则默认允许 black/white/transparent/current/inherit；不检查任意 hex，不能单独构成语义色闭环 |
| `noTailwindArbitraryValue` | 拦 `bg-[#245b50]`、`rounded-[7px]`、`[color:...]` 等 | 同时会拦合法布局尺寸；任意 selector variant 不在该规则范围。支持具体类或类别例外，不能大范围放开后仍称严格约束 |
| `noTailwindRestyledComponents` | 拦大写组件调用上的色彩、字形、内边距/间距、形状、效果和动效覆盖 | 按组件名字形态判断，不会理解“这是原语实现内部”；原生 DOM 不检查。命名组件白名单只放必要类别/精确类 |
| `useTailwindStaticClassStrings` | 拦模板插值和字符串拼接的动态类名 | 不追踪变量赋值，不保证所有动态来源都可分析 |

规则细节以 [raw colors](https://biomejs.dev/linter/rules/no-tailwind-raw-colors/javascript/)、[arbitrary value](https://biomejs.dev/linter/rules/no-tailwind-arbitrary-value/javascript/)、[restyled components](https://biomejs.dev/linter/rules/no-tailwind-restyled-components/javascript/)、[static strings](https://biomejs.dev/linter/rules/use-tailwind-static-class-strings/javascript/) 为据，并核对本机 schema。

建议配置显式指定 `tailwind.stylesheet: "./src/index.css"`。默认识别 `class` / `className`、`cn` 等合并函数以及 `cva` 等变体函数；自建 helper 会扩大识别成本，优先不再增加。新规则默认可能只是 information，门禁必须显式设为 error，不能依靠退出码为 0 推断样式没有问题。

## 本机探针

使用项目内 Biome 2.6.4，在仓库外临时目录创建独立 CSS、TSX 与 config，前三条规则显式设为 error；未改仓库配置、依赖或源码。

| 样例 | 结果 |
| --- | --- |
| `bg-primary text-foreground` | 通过 |
| `hover:bg-emerald-600/80` | 原始色板规则拦截 |
| `bg-[#245b50]`、`[color:#245b50]` | 任意值规则拦截 |
| `Button` 调用方写 `rounded-none bg-primary text-lg p-4` | 外观覆盖规则拦截；即便颜色是语义色也不能随意覆盖 |
| `Button variant="outline" className="mt-4 w-full"` | 通过 |
| `Panel className="p-4 gap-2"` | 外观覆盖规则拦截：合法布局容器也可能需要明确边界 |
| CVA 中 `bg-emerald-600`、`rounded-[7px]` | 分别拦截，识别不只限 JSX |
| `hover:bg-primary` 与 `rounded-none!` 覆盖 Button | 外观覆盖规则拦截 |
| `w-[347px]` | 任意值规则拦截，说明不能无差别禁止领域布局 |
| `bg-white text-black` | 通过，是原始色板规则的已知允许项 |
| 原生 div 的 `rounded-3xl text-4xl` | 通过，三条规则不构成所有视觉尺度的封闭集合 |
| `style={{ color: "#245b50", borderRadius: 19 }}` | 通过，三条规则不检查 inline style |
| 动态 `bg-${color}-600` | 前三条通过；另开 `useTailwindStaticClassStrings` 后拦截 |

共 14 个初始样例及 1 个静态字符串补充探针。另对当前 174 个源码文件只读启用前三条规则扫描，得到 764 条 info：原始色板 1、任意值 95、组件覆盖 668；其中共享 `ui/` 内分别为 0、62、479。数字是规则命中数，不是缺陷数。共享组件内部套用 Base UI、组件布局和合法领域尺寸都会命中，不能直接全局开 error 后批量自动修复。

可重复进行只读盘点：

```sh
pnpm exec biome lint src \
  --only=nursery/noTailwindRawColors \
  --only=nursery/noTailwindRestyledComponents \
  --only=nursery/noTailwindArbitraryValue \
  --reporter=json
```

诊断级别由配置控制；该盘点命令不等同未来的 error 门禁。

## 建议的约束边界

| 层 | 允许 | 不允许 |
| --- | --- | --- |
| 主题定义 | 亮暗主题值、语义映射、状态色对、命名文字/圆角/动效尺度 | 多份手写主题真相、从图片反向采样主题值 |
| 共享 `ui/` 实现 | 定义外观、CVA 变体、原语状态样式，使用语义 token | 每个组件重新发明颜色、未登记的永久一次性数值 |
| 布局组合 | 声明布局、宽度、间距和响应式优先级，必要时使用命名布局组件 | 改叶子控件的颜色、字重、内部 padding、圆角和焦点 |
| 业务页面 | 使用现成组件与有限 variant/size，容器上使用语义色 | 拼接类名、`!important` 压制主题、单页硬写 `dark:` 配色、用 style 绕过 token |
| 阅读器/目录/音轨 | 动态偏移、尺寸、坐标、播放位置；有理由的精确布局 | 把功能几何当作任意换颜色或新增外观尺度的通行证 |

`noTailwindRestyledComponents` 必须在原语实现边界另设规则；业务布局组件的例外按名字、类别或精确类登记，不能 `components: "*"` 放开所有外观。`noTailwindArbitraryValue` 先区分视觉尺度与领域几何；把可复用的尺寸提升为命名 token，真实动态值仍留在领域。

对普通元素上的任意圆角/字号、black/white、inline 视觉属性和散落 CSS，现有四条规则仍有缺口。后续只补这些已证明的缺口：优先用有限语义 token 暴露面和共享组件 API，再按需要增加小型 Biome 插件。不要先自研整套 Tailwind 正则分析器。`noInlineStyles` 会同时禁止合法动态几何，不能全站一刀切；不能用“挪到 style”作为绕过工具类检查的办法。

Tailwind 官方允许移除默认颜色 namespace，但这只减少可生成的颜色工具类，不等于 CI 会诊断违规，也要兼容 Streamdown 等依赖的工具类。若采用，须和诊断、主题完整性及第三方渲染回归一起验证。[官方颜色配置](https://tailwindcss.com/docs/colors)

## 建议落地顺序

1. 先把静阅青的完整 token 与组件责任写进对应 OpenSpec，当前方案不直接启用门禁。
2. 按实际调用位置盘点例外，先迁移共享 Button、Field、Select、Dialog、资源行和反馈模式；不把 764 个命中当作需要逐条 suppress 的清单。
3. 在迁移模块启用四条 error，保留现有排序与类简写；规则升级时复跑上述正反例，防止 nursery 行为漂移。
4. 对确定的 token 绕过补窄规则，并记录例外理由；避免长期维护“只检查改动行”的债务基线。
5. 验收两个独立维度：静态工具能拦住违规写法；真实组件和页面在主题、语言、窗口、焦点与错误路径中行为正确。两者互不替代。

这能让“遵守设计系统”逐步成为代码约束，同时保留正文与音频领域必须具有的布局能力。
