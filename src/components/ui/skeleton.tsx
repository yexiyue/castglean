import { cn } from "cn";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-muted animate-pulse motion-reduce:animate-none rounded-md", className)}
      {...props}
    />
  );
}

export { Skeleton };
