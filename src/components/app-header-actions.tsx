import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
import { CpuIcon, SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useModelResources } from "@/hooks/use-model-resources";
import { useDesktopSession } from "@/lib/desktop-session";
import { downloadPercent, stateLabel, variantOf } from "@/lib/models";

export function ModelStatusChip() {
  const { t } = useLingui();
  const { entries, loading, error } = useModelResources();
  const downloading = entries.find(
    (entry) => variantOf(entry.resource) === "Downloading",
  );
  const percent = downloading ? downloadPercent(downloading.resource) : null;
  const preparing = entries.find(
    (entry) => variantOf(entry.resource) === "Preparing",
  );
  const ready = entries.filter(
    (entry) => variantOf(entry.resource) === "Ready",
  ).length;
  let label = t({ comment: "顶栏读取模型状态", message: "读取模型…" });
  if (!isTauri())
    label = t({ comment: "浏览器没有桌面引擎", message: "浏览器预览" });
  else if (error)
    label = t({ comment: "模型目录读取失败", message: "模型不可用" });
  else if (downloading)
    label =
      percent === null
        ? t({ message: "模型下载中" })
        : t({ message: `模型下载中 ${percent}%` });
  else if (preparing) label = t(stateLabel(preparing.resource).label);
  else if (!loading)
    label =
      ready > 0
        ? t({ message: `已就绪 ${ready} 个模型` })
        : t({ comment: "本机尚无就绪模型", message: "模型未准备" });
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground h-8 gap-2"
      nativeButton={false}
      render={<Link to="/models" />}
    >
      <CpuIcon />
      <span className="max-w-40 truncate text-xs">{label}</span>
    </Button>
  );
}

export function SettingsTrigger() {
  const { t } = useLingui();
  const { openSettings } = useDesktopSession();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => openSettings("general")}
            aria-label={t({ comment: "打开应用设置", message: "设置" })}
          />
        }
      >
        <SettingsIcon />
      </TooltipTrigger>
      <TooltipContent>
        <Trans comment="打开应用设置">设置</Trans>
      </TooltipContent>
    </Tooltip>
  );
}
