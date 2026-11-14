# 组件内变体覆盖基础样式需提升选择器特异性

日期：2026-11-14。适用：React 19 + Tailwind v4 + `cn()`（clsx 封装，无 tailwind-merge）。

## 问题

给共享组件加变体（如 `Card variant="section"`）时，在 `cn(base, variantClass)` 里用同名工具类覆盖基础类（如 `rounded-none` 覆盖 `rounded-surface`、`bg-transparent` 覆盖 `bg-card`）不可靠：`cn` 不做 tailwind-merge，两个类同时进入 class 属性，最终由 Tailwind 生成的 CSS 源顺序决定胜负。实测 `bg-transparent` 恰好胜出而 `rounded-none` 落败（圆角保持 12px），同一处代码一半生效一半失效。

## 修复

变体类统一挂到组件已有的 `data-*` 属性上，用 Tailwind 的属性变体提升特异性（0,2,0 > 单类 0,1,0），与 CSS 源顺序无关：

```tsx
data-variant={variant}
// className：
variant === "section" &&
  "data-[variant=section]:rounded-none data-[variant=section]:border-x-0 …"
```

设置页原先用容器级 `[&_[data-slot=card]]:` 任意变体链压制卡片样式，特异性同样靠后代选择器取胜；但那是对组件的体外改造（biome `noTailwindRestyledComponents` 也会拦业务侧同类写法），已由一等变体替代（`src/components/ui/card.tsx`，2026-11-14）。

## 边界

- `has-data-*` / `[&_…]` 等带修饰的类不与基础类冲突，无需处理。
- 给变量组件（如 `category.icon`）传 `className` 会触发 lint；需要按实例着色时用 `display:contents` 的透明 span 包一层，让颜色继承进去（settings-panel 分类图标弱色）。
- 浏览器与真实桌面验证均通过；其他平台无差异（纯 CSS 行为）。
