import { Trans } from "@lingui/react/macro";
import { isTauri } from "@tauri-apps/api/core";
import { FolderOpenIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { commands } from "@/lib/bindings";

export function OpenModelCacheButton({
  variant = "outline",
}: {
  /** 设置页密度较高时用 ghost 降低次要动作的视觉权重；模型中心保持 outline。 */
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function open() {
    setBusy(true);
    setFailed(false);
    try {
      await commands.openModelCache();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={variant}
        size="sm"
        disabled={!isTauri() || busy}
        onClick={() => void open()}
      >
        <FolderOpenIcon data-icon="inline-start" />
        <Trans comment="在 Finder 或文件资源管理器中打开宿主当前生效的模型缓存文件夹">
          打开缓存目录
        </Trans>
      </Button>
      {failed && (
        <span role="alert" className="text-destructive text-xs">
          <Trans>无法打开缓存目录，请检查目录权限后重试。</Trans>
        </span>
      )}
    </div>
  );
}
