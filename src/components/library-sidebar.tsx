import { useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { AudioWaveformIcon, CpuIcon, LibraryBigIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import logoUrl from "../../assets/brand/logo.png";

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
  to: "/" | "/voices" | "/models";
  icon: typeof LibraryBigIcon;
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
              variant: selected ? "selected" : "ghost",
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
    to: "/" | "/voices" | "/models";
    label: string;
    icon: typeof LibraryBigIcon;
  }[] = [
    {
      id: "projects",
      to: "/" as const,
      label: t({ comment: "工程列表导航", message: "工程" }),
      icon: LibraryBigIcon,
    },
    {
      id: "voices",
      to: "/voices" as const,
      label: t({ comment: "共享音色库导航", message: "音色中心" }),
      icon: AudioWaveformIcon,
    },
    {
      id: "models",
      to: "/models" as const,
      label: t({ comment: "本机模型资源导航", message: "模型中心" }),
      icon: CpuIcon,
    },
  ];
  return (
    <aside
      data-slot="library-sidebar"
      className="bg-sidebar border-border flex w-14 shrink-0 flex-col items-center border-r"
    >
      {/* 品牌标记不做导航：回工程首页由顶栏入口承担，避免同一目的地出现多个入口。 */}
      <div className="flex h-12 shrink-0 items-center justify-center">
        <img src={logoUrl} alt="" className="size-7 object-contain" />
      </div>
      {/* 侧栏只放目的地，名称由悬停提示提供；「新建工程」是动作，入口收敛到顶栏加号与工程页主行动。 */}
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
    </aside>
  );
}
