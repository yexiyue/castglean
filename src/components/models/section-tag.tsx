import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** 属性分区的小标签胶囊：图标 + 11px 文字，自带底色，作为分组锚点。 */
export function SectionTag({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <h3>
      <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium">
        <Icon aria-hidden="true" className="size-3" />
        {children}
      </span>
    </h3>
  );
}
