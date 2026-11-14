import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Native keyboard behavior with the same geometry and focus as other inputs. */
export function NativeSelect({
  className,
  density = "default",
  ...props
}: ComponentProps<"select"> & { density?: "default" | "compact" }) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 rounded-control h-8 max-w-full min-w-0 border px-2.5 text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        density === "compact" && "h-7 px-1 text-xs",
        className,
      )}
      {...props}
    />
  );
}
