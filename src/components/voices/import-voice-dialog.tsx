import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { FileAudioIcon, UploadIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

export function ImportVoiceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [invalid, setInvalid] = useState(false);
  function choose(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".voice") || !file.size) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setFile(file);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans comment="导入已打包的音色资产">导入音色包</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>打开由 TaleChime 导出的 .voice 文件，恢复已有音色。</Trans>
          </DialogDescription>
        </DialogHeader>
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-4 right-4"
              aria-label={t({
                comment: "关闭音色包导入对话框",
                message: "关闭导入",
              })}
            />
          }
        >
          <XIcon />
        </DialogClose>
        <input
          ref={input}
          type="file"
          accept=".voice"
          className="hidden"
          aria-label={t({
            comment: "选择已有的 .voice 音色包文件",
            message: "音色包文件",
          })}
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <fieldset
          aria-label={t({ message: "音色包文件" })}
          className="border-border rounded-xl border border-dashed p-6"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            choose(e.dataTransfer.files[0]);
          }}
        >
          {file ? (
            <div className="flex items-start gap-3">
              <FileAudioIcon className="text-muted-foreground mt-1 size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
                <Badge variant="outline" className="mt-3">
                  <Trans comment="文件已选择但尚未由宿主校验">待校验</Trans>
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => input.current?.click()}
              >
                <Trans comment="重新选择音色包文件">更换文件</Trans>
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <UploadIcon className="text-muted-foreground size-6" />
              <p className="text-sm font-medium">
                <Trans>拖入音色包，或选择文件</Trans>
              </p>
              <p className="text-muted-foreground text-xs">
                <Trans>参考录音请通过“创建音色”添加。</Trans>
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => input.current?.click()}
              >
                <Trans comment="从系统文件选择器选择 .voice 文件">
                  选择音色包
                </Trans>
              </Button>
            </div>
          )}
        </fieldset>
        {invalid && (
          <p role="alert" className="text-destructive text-xs">
            <Trans>请选择非空的 .voice 音色包文件。</Trans>
          </p>
        )}
        <p className="text-muted-foreground text-xs leading-6">
          <Trans>
            连接音色服务后，可读取音色信息并检查是否存在同名资源。当前文件仅在本机选择，尚未导入。
          </Trans>
        </p>
        <DialogFooter>
          <Button
            variant="ghost"
            nativeButton={false}
            render={
              <Link to="/settings/$section" params={{ section: "models" }} />
            }
            onClick={() => onOpenChange(false)}
          >
            <Trans comment="前往模型与后端设置">连接音色服务</Trans>
          </Button>
          <Button disabled>
            <Trans comment="确认导入经校验的资源，宿主尚未接入">
              导入音色库
            </Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
