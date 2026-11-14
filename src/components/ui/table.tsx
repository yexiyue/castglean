import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type * as React from "react";

/**
 * 表格原语：视觉策略在定义内以变体提供，使用方不传视觉 className。
 * Table 不带滚动包裹层——外层滚动容器由使用方提供，否则粘性表头
 * 会吸附到错误的滚动容器上。表头默认 muted 底、前景 medium；行的
 * 悬浮由 TableBody 统一施加。
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
        sticky && "[&_>tr>th]:top-0 [&_>tr>th]:sticky [&_>tr>th]:z-10",
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
        "[&_tr:last-child]:border-0 [&_tr:hover]:bg-accent/50",
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
        "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
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
  /** interactive：整行可点（配合首格按钮的 stretched 覆盖层）。 */
  interactive?: boolean;
}) {
  return (
    <tr
      data-slot="table-row"
      data-interactive={interactive || undefined}
      className={cn(
        "border-border border-b",
        interactive && "relative",
        className,
      )}
      {...props}
    />
  );
}

const headVariants = cva(
  "text-foreground bg-muted/50 h-10 px-3 text-left align-middle text-xs font-medium whitespace-nowrap",
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
      muted: "text-muted-foreground text-xs",
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
    /** overlap：盖在整行点击覆盖层之上（勾选框等行内交互控件所在格）。 */
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
      className={cn("text-muted-foreground mt-3 text-sm", className)}
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
