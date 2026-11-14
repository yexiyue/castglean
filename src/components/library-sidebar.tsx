import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import {
  AudioWaveformIcon,
  CircleHelpIcon,
  CpuIcon,
  LibraryBigIcon,
  SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useDesktopSession } from "@/lib/desktop-session";
import logoUrl from "../../assets/brand/logo.png";

type NavId = "projects" | "voices" | "models" | "start";

/** 导航项：选中 = selected 变体（强调底+字重+左指示），图标随之提亮。 */
function NavItem({
  active,
  id,
  to,
  icon: Icon,
  children,
}: {
  active?: NavId;
  id: NavId;
  to: "/" | "/voices" | "/models" | "/start";
  icon: typeof SettingsIcon;
  children: ReactNode;
}) {
  const selected = active === id;
  return (
    <Link
      to={to}
      className={buttonVariants({
        variant: selected ? "selected" : "ghost",
        size: "row",
        className: "justify-start",
      })}
      aria-current={selected ? "page" : undefined}
    >
      <Icon
        className={
          selected ? "text-accent-foreground/70" : "text-muted-foreground"
        }
      />
      {children}
    </Link>
  );
}

export function LibrarySidebar({ active }: { active?: NavId }) {
  const { t } = useLingui();
  const { openSettings } = useDesktopSession();
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
      className="bg-sidebar border-border flex w-52 shrink-0 flex-col border-r max-sm:w-40"
    >
      <Link
        to="/"
        className="focus-visible:ring-ring flex h-12 items-center gap-2.5 px-4 outline-none focus-visible:ring-2"
        aria-label="CastGlean"
      >
        <img src={logoUrl} alt="" className="size-7 shrink-0 object-contain" />
        <span className="text-sm font-semibold tracking-tight">CastGlean</span>
      </Link>
      {/* 侧栏只放目的地；「新建工程」是动作，入口收敛到顶栏加号与工程页主行动，不混入导航。 */}
      <nav
        aria-label={t({ comment: "应用级目的地导航", message: "应用导航" })}
        className="flex flex-col gap-1 px-3 pt-3"
      >
        {nav.map((item) => (
          <NavItem
            active={active}
            key={item.id}
            id={item.id}
            to={item.to}
            icon={item.icon}
          >
            {item.label}
          </NavItem>
        ))}
      </nav>
      <div className="border-border mt-auto flex flex-col gap-1 border-t p-3">
        <NavItem active={active} id="start" to="/start" icon={CircleHelpIcon}>
          <Trans comment="首次使用的操作指引">快速上手</Trans>
        </NavItem>
        <Button
          variant="ghost"
          size="row"
          className="justify-start"
          onClick={() => openSettings("general")}
        >
          <SettingsIcon className="text-muted-foreground" />
          <Trans comment="打开应用设置">设置</Trans>
        </Button>
      </div>
    </aside>
  );
}
