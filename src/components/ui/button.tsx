import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const buttonVariants = cva(
  "group/button focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 rounded-control inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none select-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground aria-expanded:bg-secondary aria-expanded:text-secondary-foreground hover:bg-secondary-hover",
        ghost:
          "hover:bg-accent/60 hover:text-foreground aria-expanded:bg-accent/60 aria-expanded:text-foreground dark:hover:bg-accent/60",
        // 统一选中语言：选中 = 强调底色 + 字重，仅用于导航项与列表当前项。
        selected:
          "bg-accent text-accent-foreground hover:bg-accent font-medium",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "rounded-control in-data-[slot=button-group]:rounded-control h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "rounded-control in-data-[slot=button-group]:rounded-control h-7 gap-1 px-2.5 text-control-sm has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        picker:
          "h-7 gap-1 px-2 text-control-sm [&_svg:not([class*='size-'])]:size-3.5",
        row: "rounded-item h-8 gap-1.5 px-2",
        "detail-row":
          "h-auto items-start gap-2 rounded-none px-3 py-2 text-left",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        inline: "h-auto p-0 text-control-sm",
        nav: "h-auto min-h-14 w-full flex-col gap-1 px-1 py-2 text-xs leading-tight whitespace-normal",
        icon: "size-8",
        "icon-xs":
          "rounded-control in-data-[slot=button-group]:rounded-control size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "rounded-control in-data-[slot=button-group]:rounded-control size-7",
        "icon-lg": "size-9",
      },
      multiline: { true: "h-auto py-2 whitespace-normal" },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  multiline,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, multiline, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
