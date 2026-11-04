import logoUrl from "../../assets/brand/logo.png";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { AudioWaveformIcon, ClockIcon, PlusIcon, CpuIcon } from "lucide-react";
import { QuickSettings } from "@/components/quick-settings";
import { OpenProjectButton } from "@/components/projects/project-file-controls";
import { Button } from "@/components/ui/button";

export function LibrarySidebar({
  active,
}: {
  active: "projects" | "voices" | "models";
}) {
  const { t } = useLingui();
  return (
    <aside
      data-slot="library-sidebar"
      className="bg-sidebar border-border flex w-56 shrink-0 flex-col border-r px-4 max-sm:w-16 max-sm:px-2"
    >
      <Link
        to="/"
        className="flex h-20 shrink-0 items-center gap-2.5 px-2 max-sm:justify-center max-sm:px-0"
        aria-label="CastGlean"
      >
        <img src={logoUrl} alt="" className="size-9 shrink-0 object-contain" />
        <span className="text-base font-semibold max-sm:hidden">CastGlean</span>
      </Link>
      <div className="mb-7 flex flex-col gap-2 max-sm:hidden">
        <Button
          className="justify-start"
          nativeButton={false}
          render={<Link to="/new" />}
        >
          <PlusIcon data-icon="inline-start" />
          <Trans comment="创建新的制作工程">新建工程</Trans>
        </Button>
        <OpenProjectButton fullWidth />
      </div>
      <nav
        aria-label={t({
          comment: "进入工程之前的应用导航",
          message: "应用导航",
        })}
        className="flex flex-col gap-1"
      >
        <Button
          variant={active === "projects" ? "secondary" : "ghost"}
          className="justify-start"
          nativeButton={false}
          render={<Link to="/" />}
          aria-label={t({ comment: "首页工程列表导航", message: "最近工程" })}
        >
          <ClockIcon data-icon="inline-start" />
          <span className="max-sm:hidden">
            <Trans comment="首页工程列表导航">最近工程</Trans>
          </span>
        </Button>
        <Button
          variant={active === "voices" ? "secondary" : "ghost"}
          className="justify-start"
          nativeButton={false}
          render={<Link to="/voices" />}
          aria-label={t({
            comment: "应用级跨小说共享音色资源",
            message: "音色中心",
          })}
        >
          <AudioWaveformIcon data-icon="inline-start" />
          <span className="max-sm:hidden">
            <Trans comment="应用级跨小说共享音色资源">音色中心</Trans>
          </span>
        </Button>
        <Button
          variant={active === "models" ? "secondary" : "ghost"}
          className="justify-start"
          nativeButton={false}
          render={<Link to="/models" />}
          aria-label={t({
            comment: "应用级共享模型资源页面标题",
            message: "模型中心",
          })}
        >
          <CpuIcon data-icon="inline-start" />
          <span className="max-sm:hidden">
            <Trans comment="应用级共享模型资源页面标题">模型中心</Trans>
          </span>
        </Button>
      </nav>
      <footer className="mt-auto py-4">
        <QuickSettings active={false} labeled />
      </footer>
    </aside>
  );
}
