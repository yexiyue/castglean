import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useLocation } from "@tanstack/react-router";
import { SettingsIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOpenSettings } from "@/lib/desktop-session";
import { cn } from "@/lib/utils";
import logoUrl from "../../assets/brand/logo.png";

export function RailHomeLink() {
  const { t } = useLingui();
  const active = useLocation({
    select: (location) => location.pathname === "/",
  });
  const label = t({
    comment: "侧栏品牌图标，返回工程列表",
    message: "工程首页",
  });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to="/"
            activeOptions={{ exact: true }}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={cn(
              buttonVariants({
                variant: active ? "secondary" : "ghost",
                size: "icon-lg",
              }),
              "shrink-0 translate-y-2",
            )}
          />
        }
      >
        <img src={logoUrl} alt="" className="size-7 object-contain" />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function SettingsTrigger() {
  const { t } = useLingui();
  const openSettings = useOpenSettings();
  const { pathname } = useLocation();
  const active = pathname === "/settings";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={active ? "secondary" : "ghost"}
            size="icon-lg"
            onClick={() => openSettings("general")}
            aria-current={active ? "page" : undefined}
            aria-label={t({ comment: "打开应用设置", message: "设置" })}
          />
        }
      >
        <SettingsIcon
          className={
            active ? "text-accent-foreground/70" : "text-muted-foreground"
          }
        />
      </TooltipTrigger>
      <TooltipContent side="right">
        <Trans comment="打开应用设置">设置</Trans>
      </TooltipContent>
    </Tooltip>
  );
}

/** 应用级侧栏底部：设置入口固定在最左侧底部。 */
export function RailFooter() {
  return (
    <div
      data-slot="rail-footer"
      className="mt-auto flex shrink-0 items-center justify-center pb-3"
    >
      <SettingsTrigger />
    </div>
  );
}
