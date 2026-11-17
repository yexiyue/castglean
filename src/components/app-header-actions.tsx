import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useLocation } from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
import { CpuIcon, SettingsIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useModelResources } from "@/hooks/use-model-resources";
import { useOpenSettings } from "@/lib/desktop-session";
import { downloadPercent, stateLabel, variantOf } from "@/lib/models";

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

function ModelStatusTrigger() {
  const { t } = useLingui();
  const { pathname } = useLocation();
  const { entries, loading, error } = useModelResources();
  const active = pathname === "/models";
  const downloading = entries.find(
    (entry) => variantOf(entry.resource) === "Downloading",
  );
  const preparing = entries.find(
    (entry) => variantOf(entry.resource) === "Preparing",
  );
  const ready = entries.filter(
    (entry) => variantOf(entry.resource) === "Ready",
  ).length;
  let label = t({ comment: "侧栏读取模型状态", message: "读取模型…" });
  if (!isTauri()) label = t({ message: "浏览器预览" });
  else if (error) label = t({ message: "模型不可用" });
  else if (downloading) {
    const percent = downloadPercent(downloading.resource);
    label =
      percent === null
        ? t({ message: "模型下载中" })
        : t({ message: `模型下载中 ${percent}%` });
  } else if (preparing) label = t(stateLabel(preparing.resource).label);
  else if (!loading)
    label =
      ready > 0
        ? t({ message: `已就绪 ${ready} 个模型` })
        : t({ message: "模型未准备" });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to="/models"
            className={buttonVariants({
              variant: active ? "selected" : "ghost",
              size: "icon-lg",
            })}
            aria-current={active ? "page" : undefined}
            aria-label={t`模型中心`}
            aria-description={label}
          />
        }
      >
        <CpuIcon className="text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent side="right">
        <Trans>模型中心</Trans> · {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** 应用级侧栏底部：设置入口固定在最左侧底部。 */
export function RailFooter() {
  return (
    <div
      data-slot="rail-footer"
      className="mt-auto flex shrink-0 flex-col items-center gap-1 pb-3"
    >
      <ModelStatusTrigger />
      <SettingsTrigger />
    </div>
  );
}
