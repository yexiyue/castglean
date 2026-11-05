import { Trans, useLingui } from "@lingui/react/macro";
import { XIcon } from "lucide-react";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDesktopSession } from "@/lib/desktop-session";

/**
 * 设置以浮层出现：保留当前页面上下文，改完直接回到原处。
 * 分类切换写回会话状态，因此从任意页面都能直达某个分区。
 */
export function SettingsDialog() {
  const { t } = useLingui();
  const { settingsOpen, settingsSection, openSettings, closeSettings } =
    useDesktopSession();
  return (
    <Dialog
      open={settingsOpen}
      onOpenChange={(next) => {
        if (!next) closeSettings();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(42rem,calc(100dvh-4rem))] max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(56rem,calc(100%-2rem))]"
      >
        <DialogHeader className="border-border shrink-0 border-b px-6 py-4 pr-16">
          <DialogTitle>
            <Trans comment="设置浮层标题">设置</Trans>
          </DialogTitle>
          <DialogDescription className="sr-only">
            <Trans>应用外观、语言、服务连接和存储设置。</Trans>
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          <SettingsPanel
            section={settingsSection}
            onSectionChange={(section) => openSettings(section)}
          />
        </div>
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-3 right-3"
              aria-label={t({
                comment: "关闭设置浮层",
                message: "关闭",
              })}
            />
          }
        >
          <XIcon />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
