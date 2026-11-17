import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type * as React from "react";

/**
 * 表格原语：视觉策略在定义内以变体提供，使用方不传视觉 className。
 * Table 不带滚动包裹层——外层滚动容器由使用方提供，否则粘性表头
 * 会吸附到错误的滚动容器上。表头底色由 TableHeader 决定：普通表头用
 * muted 半透明底，粘性表头用不透明底，避免滚动内容从表头下方透出；
 * 行的悬浮由 TableBody 统一施加。
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <table
      data-slot="table"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  );
}

function TableHeader({
  className,
  sticky = false,
  ...props
}: React.ComponentProps<"thead"> & { sticky?: boolean }) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "[&_tr]:border-b",
        sticky
          ? "[&_>tr>th]:sticky [&_>tr>th]:top-0 [&_>tr>th]:z-10 [&_>tr>th]:bg-muted"
          : "[&_>tr>th]:bg-muted/50",
        className,
      )}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn(
        "[&_tr:hover]:bg-accent/50 [&_tr:last-child]:border-0",
        className,
      )}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

function TableRow({
  className,
  interactive = false,
  ...props
}: React.ComponentProps<"tr"> & {
  /**
   * interactive：整行可点，由使用方挂 onClick 实现。
   * 不能用「首格按钮的 ::after 铺满整行」的做法：表格行上的
   * position: relative 在 WebKit（macOS 桌面 WebView）不生效，覆盖层会
   * 逃出整行、铺满窗口，导致点击任何位置都触发行内操作。
   */
  interactive?: boolean;
}) {
  return (
    <tr
      data-slot="table-row"
      data-interactive={interactive || undefined}
      className={cn(
        "border-b border-border",
        interactive && "cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}

const headVariants = cva(
  "h-10 px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-foreground",
  {
    variants: {
      width: {
        auto: "",
        full: "w-full",
        icon: "w-10",
        time: "w-28",
      },
      truncate: {
        none: "",
        sm: "max-w-40",
        md: "max-w-56",
        lg: "max-w-64",
      },
    },
    defaultVariants: { width: "auto", truncate: "none" },
  },
);

function TableHead({
  className,
  width,
  truncate,
  ...props
}: React.ComponentProps<"th"> & VariantProps<typeof headVariants>) {
  return (
    <th
      data-slot="table-head"
      className={cn(headVariants({ width, truncate }), className)}
      {...props}
    />
  );
}

const cellVariants = cva("px-3 py-2.5 align-middle whitespace-nowrap", {
  variants: {
    tone: {
      default: "",
      muted: "text-xs text-muted-foreground",
    },
    numeric: {
      true: "tabular-nums",
    },
    truncate: {
      none: "",
      sm: "max-w-40 truncate",
      md: "max-w-56 truncate",
      lg: "max-w-64 truncate",
    },
    width: {
      auto: "",
      icon: "w-10",
      time: "w-28",
      full: "w-full",
    },
    /** overlap：抬升行内交互控件所在的格（勾选框等），避免被行的悬浮底色压住。 */
    overlap: {
      true: "relative z-10",
    },
  },
  defaultVariants: {
    tone: "default",
    truncate: "none",
    width: "auto",
  },
});

function TableCell({
  className,
  tone,
  numeric,
  truncate,
  width,
  overlap,
  ...props
}: React.ComponentProps<"td"> & VariantProps<typeof cellVariants>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        cellVariants({ tone, numeric, truncate, width, overlap }),
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-3 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
};
