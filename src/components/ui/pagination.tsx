import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import { cn } from "cn";
import type * as React from "react";

/**
 * 数字分页（shadcn blocks 形态）：上一页/下一页 + 页码按钮 + 省略号。
 * 页面跳转通过 onClick 回调完成，不承载路由。
 */
function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="pagination"
      className={cn(
        "text-muted-foreground flex items-center justify-center",
        className,
      )}
      {...props}
    />
  );
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex flex-row items-center gap-1", className)}
      {...props}
    />
  );
}

function PaginationItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li data-slot="pagination-item" className={cn("", className)} {...props} />
  );
}

function PaginationPage({
  page,
  isActive = false,
  onClick,
  ...props
}: Omit<React.ComponentProps<"button">, "onClick" | "children"> & {
  page: number;
  isActive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-slot="pagination-page"
      data-active={isActive || undefined}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "focus-visible:ring-ring inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-control text-sm tabular-nums outline-none transition-colors focus-visible:ring-2",
        isActive
          ? "bg-primary text-primary-foreground pointer-events-none"
          : "hover:bg-accent hover:text-foreground",
      )}
      onClick={onClick}
      {...props}
    >
      {page}
    </button>
  );
}

function PaginationPrevious({
  onClick,
  disabled = false,
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "onClick"> & {
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-slot="pagination-previous"
      className={cn(
        "focus-visible:ring-ring inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-control px-2.5 py-1.5 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-2",
        disabled
          ? "pointer-events-none opacity-50"
          : "hover:bg-accent hover:text-foreground",
      )}
      disabled={disabled}
      onClick={onClick}
      {...props}
    >
      <ChevronLeftIcon data-icon="inline-start" className="size-4" />
      {children}
    </button>
  );
}

function PaginationNext({
  onClick,
  disabled = false,
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "onClick"> & {
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-slot="pagination-next"
      className={cn(
        "focus-visible:ring-ring inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-control px-2.5 py-1.5 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-2",
        disabled
          ? "pointer-events-none opacity-50"
          : "hover:bg-accent hover:text-foreground",
      )}
      disabled={disabled}
      onClick={onClick}
      {...props}
    >
      {children}
      <ChevronRightIcon data-icon="inline-end" className="size-4" />
    </button>
  );
}

function PaginationEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="pagination-ellipsis"
      aria-hidden="true"
      className={cn("flex size-8 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontalIcon className="size-4" />
    </span>
  );
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPage,
  PaginationPrevious,
};
