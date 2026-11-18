import { Trans, useLingui } from "@lingui/react/macro";
import { useLocation } from "@tanstack/react-router";
import { SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOpenSettings } from "@/lib/desktop-session";

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
            variant={active ? "selected" : "ghost"}
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
