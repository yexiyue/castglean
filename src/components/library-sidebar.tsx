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
import { Button } from "@/components/ui/button";
import { useDesktopSession } from "@/lib/desktop-session";
import logoUrl from "../../assets/brand/logo.png";

export function LibrarySidebar({
  active,
}: {
  active: "projects" | "voices" | "models" | "start";
}) {
  const { t } = useLingui();
  const { openSettings } = useDesktopSession();
  const nav = [
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
        <span className="text-sm font-semibold">CastGlean</span>
      </Link>
      <div className="flex flex-col gap-2 px-3 pb-5">
        <Button
          className="h-9 justify-start px-3"
          nativeButton={false}
          render={<Link to="/new" />}
        >
          <PlusIcon />
          <Trans comment="新建小说制作工程">新建工程</Trans>
        </Button>
      </div>
      <nav
        aria-label={t({ comment: "跨工程资源导航", message: "应用导航" })}
        className="flex flex-col gap-1 px-3"
      >
        {nav.map((item) => (
          <Button
            key={item.id}
            variant={active === item.id ? "secondary" : "ghost"}
            className="h-9 justify-start px-3"
            nativeButton={false}
            render={<Link to={item.to} />}
            aria-current={active === item.id ? "page" : undefined}
          >
            <item.icon className="text-muted-foreground" />
            {item.label}
          </Button>
        ))}
      </nav>
      <div className="border-border mt-auto flex flex-col gap-1 border-t p-3">
        <Button
          variant={active === "start" ? "secondary" : "ghost"}
          className="h-9 justify-start px-3"
          nativeButton={false}
          render={<Link to="/start" />}
          aria-current={active === "start" ? "page" : undefined}
        >
          <CircleHelpIcon className="text-muted-foreground" />
          <Trans comment="首次使用的操作指引">快速上手</Trans>
        </Button>
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
