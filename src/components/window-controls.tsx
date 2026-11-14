import { useLingui } from "@lingui/react/macro";
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Only Windows draws buttons; macOS keeps native traffic lights and Linux its frame. */
export function WindowControls({
  maximized,
  perform,
}: {
  maximized: boolean;
  perform: (action: "minimize" | "maximize" | "close") => Promise<void>;
}) {
  const { t } = useLingui();
  const buttons = [
    {
      action: "minimize" as const,
      label: t({
        comment: "Windows 标题栏：最小化当前应用窗口",
        message: "最小化窗口",
      }),
      Icon: MinusIcon,
    },
    {
      action: "maximize" as const,
      label: maximized
        ? t({
            comment: "Windows 标题栏：将最大化窗口还原为普通大小",
            message: "还原窗口",
          })
        : t({
            comment: "Windows 标题栏：最大化当前应用窗口",
            message: "最大化窗口",
          }),
      Icon: maximized ? CopyIcon : SquareIcon,
    },
    {
      action: "close" as const,
      label: t({
        comment: "标题栏关闭应用窗口，区别于关闭工程标签",
        message: "关闭窗口",
      }),
      Icon: XIcon,
    },
  ];
  return (
    <fieldset
      className="m-0 flex h-full shrink-0 border-0 p-0"
      aria-label={t({
        comment: "Windows 标题栏窗口操作按钮组",
        message: "窗口控制",
      })}
    >
      {buttons.map(({ action, label, Icon }) => (
        <button
          key={action}
          id={action === "maximize" ? "window-maximize" : undefined}
          type="button"
          title={label}
          aria-label={label}
          className={cn(
            "window-control focus-visible:ring-ring flex h-full w-11.5 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset",
            action === "close"
              ? "hover:bg-destructive hover:text-destructive-foreground"
              : "hover:bg-foreground/10",
          )}
          onClick={() => void perform(action)}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </button>
      ))}
    </fieldset>
  );
}
