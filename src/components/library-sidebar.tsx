import { useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { AudioWaveformIcon, CpuIcon, type LucideIcon } from "lucide-react";
import { RailFooter, RailHomeLink } from "@/components/app-header-actions";
import { buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type NavId = "projects" | "voices" | "models";

/**
 * 导航项：纯图标，名称由悬停提示与无障碍名称提供。
 * 选中 = selected 变体（强调底），图标随之提亮。
 */
function NavItem({
  active,
  id,
  to,
  icon: Icon,
  label,
}: {
  active?: NavId;
  id: NavId;
  to: "/voices" | "/models";
  icon: LucideIcon;
  label: string;
}) {
  const selected = active === id;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to={to}
            className={buttonVariants({
              variant: selected ? "secondary" : "ghost",
              size: "icon-lg",
            })}
            aria-current={selected ? "page" : undefined}
            aria-label={label}
          />
        }
      >
        <Icon
          className={
            selected ? "text-accent-foreground/70" : "text-muted-foreground"
          }
        />
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function LibrarySidebar({ active }: { active?: NavId }) {
  const { t } = useLingui();
  const nav: {
    id: NavId;
    to: "/voices" | "/models";
    label: string;
    icon: LucideIcon;
  }[] = [
    {
      id: "voices",
      to: "/voices" as const,
      label: t({ comment: "共享音色库导航", message: "音色中心" }),
      icon: AudioWaveformIcon,
    },
    {
      id: "models",
      to: "/models" as const,
      label: t({ comment: "共享模型资源导航", message: "模型中心" }),
      icon: CpuIcon,
    },
  ];
  return (
    <aside
      data-slot="library-sidebar"
      className="flex w-14 shrink-0 flex-col items-center bg-sidebar"
    >
      <div className="flex h-(--app-header-height) shrink-0 items-center justify-center">
        <RailHomeLink />
      </div>
      <nav
        aria-label={t({ comment: "应用级目的地导航", message: "应用导航" })}
        className="flex flex-col items-center gap-1 px-2 pt-3"
      >
        {nav.map((item) => (
          <NavItem
            active={active}
            key={item.id}
            id={item.id}
            to={item.to}
            icon={item.icon}
            label={item.label}
          />
        ))}
      </nav>
      <RailFooter />
    </aside>
  );
}
