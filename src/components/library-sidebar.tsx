import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import {
  AudioWaveformIcon,
  CircleHelpIcon,
  ClockIcon,
  CpuIcon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useDesktopSession } from "@/lib/desktop-session";
import logoUrl from "../../assets/brand/logo.png";

type NavId = "projects" | "voices" | "models" | "start";

export function LibrarySidebar({
  active,
}: {
  active: "projects" | "voices" | "models" | "start";
}) {
  const { t } = useLingui();
  const { openSettings } = useDesktopSession();
  const nav: {
    id: NavId;
    to: "/" | "/voices" | "/models";
    label: string;
    icon: typeof ClockIcon;
  }[] = [
    {
      id: "projects",
      to: "/" as const,
      label: t({ comment: "工程列表导航", message: "最近工程" }),
      icon: ClockIcon,
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
  /** 导航项：选中 = selected 变体（强调底+字重+左指示），图标随之提亮。 */
  function NavItem({
    id,
    to,
    icon: Icon,
    children,
  }: {
    id?: NavId;
    to: "/" | "/voices" | "/models" | "/new" | "/start";
    icon: typeof PlusIcon;
    children: ReactNode;
  }) {
    const selected = active === id;
    return (
      <Button
        variant={selected ? "selected" : "ghost"}
        className="h-9 justify-start px-3"
        nativeButton={false}
        render={<Link to={to} />}
        aria-current={selected ? "page" : undefined}
      >
        <Icon
          className={
            selected ? "text-accent-foreground/70" : "text-muted-foreground"
          }
        />
        {children}
      </Button>
    );
  }
  return (
    <aside
      data-slot="library-sidebar"
      className="bg-sidebar border-border flex w-48 shrink-0 flex-col border-r max-sm:w-40 lg:w-60"
    >
      <Link
        to="/"
        className="focus-visible:ring-ring flex h-16 items-center gap-3 px-5 outline-none focus-visible:ring-2"
        aria-label="CastGlean"
      >
        <img src={logoUrl} alt="" className="size-7 shrink-0 object-contain" />
        <span className="text-sm font-semibold tracking-tight">CastGlean</span>
      </Link>
      {/* 工程入口保持导航层级；每屏唯一饱和主按钮留给页面自身的主行动。 */}
      <nav
        aria-label={t({ comment: "工程入口", message: "工程" })}
        className="flex flex-col gap-1 px-3"
      >
        <NavItem to="/new" icon={PlusIcon}>
          <Trans comment="新建小说制作工程">新建工程</Trans>
        </NavItem>
      </nav>
      <div className="border-border mx-3 my-4 border-t" aria-hidden="true" />
      <nav
        aria-label={t({ comment: "跨工程资源导航", message: "应用导航" })}
        className="flex flex-col gap-1 px-3"
      >
        {nav.map((item) => (
          <NavItem key={item.id} id={item.id} to={item.to} icon={item.icon}>
            {item.label}
          </NavItem>
        ))}
      </nav>
      <div className="border-border mt-auto flex flex-col gap-1 border-t p-3">
        <NavItem id="start" to="/start" icon={CircleHelpIcon}>
          <Trans comment="首次使用的操作指引">快速上手</Trans>
        </NavItem>
        <Button
          variant="ghost"
          className="h-9 justify-start px-3"
          onClick={() => openSettings("general")}
        >
          <SettingsIcon className="text-muted-foreground" />
          <Trans comment="打开应用设置">设置</Trans>
        </Button>
      </div>
    </aside>
  );
}
