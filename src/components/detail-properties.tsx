import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

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
      <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium">
        <Icon aria-hidden="true" className="size-3" />
        {children}
      </span>
    </h3>
  );
}

/**
 * 属性瓦片：标签在上、值在下，双列排布形成节奏。
 * primary/secondary 区分主次：关键值加重，技术细节弱化为弱灰。
 */
export function Property({
  label,
  secondary = false,
  children,
}: {
  label: ReactNode;
  secondary?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-sm wrap-break-word",
          secondary ? "text-muted-foreground" : "font-medium",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export function PropertyGroup({
  title,
  icon: Icon,
  children,
}: {
  title: ReactNode;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <SectionTag icon={Icon}>{title}</SectionTag>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</dl>
    </section>
  );
}
