import { useLingui } from "@lingui/react/macro";
import { SearchIcon, XIcon } from "lucide-react";
import { type ComponentProps, useImperativeHandle, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SearchInput({
  value,
  onValueChange,
  className,
  onKeyDown,
  ref,
  variant = "default",
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
  variant?: "default" | "quiet";
  value: string;
  onValueChange: (value: string) => void;
}) {
  const { t } = useLingui();
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current as HTMLInputElement, []);
  const clear = () => {
    onValueChange("");
    input.current?.focus();
  };
  return (
    <div className={cn("relative min-w-0", className)}>
      <SearchIcon
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
      />
      <Input
        {...props}
        ref={input}
        type="search"
        autoComplete="off"
        value={value}
        className={cn(
          "px-9 [&::-webkit-search-cancel-button]:appearance-none",
          variant === "quiet" && "border-border/50 shadow-none",
        )}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            event.stopPropagation();
            clear();
            return;
          }
          onKeyDown?.(event);
        }}
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-1/2 right-1 -translate-y-1/2"
          aria-label={t({
            message: "清除搜索",
            comment: "清空当前搜索并保留输入焦点",
          })}
          onClick={clear}
        >
          <XIcon aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
