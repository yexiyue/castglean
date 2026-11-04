import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import { FolderOpenIcon, LoaderCircleIcon, SaveIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePreviewProjects } from "@/lib/preview-projects";
import type { PreviewProject } from "@/lib/preview-projects";
import { cn } from "@/lib/utils";
import { desktop, ProjectFileError } from "@/lib/project-files";

function FileError({ error }: { error: unknown }) {
  const code = error instanceof ProjectFileError ? error.code : error;
  return (
    <p role="alert" className="text-destructive max-w-sm text-xs leading-5">
      {code === "checksum_mismatch" ? (
        <Trans>正文校验失败，工程文件可能已损坏。请打开备份。</Trans>
      ) : code === "unsupported_version" ? (
        <Trans>暂不支持此工程版本，请使用匹配版本的 CastGlean。</Trans>
      ) : code === "too_large" ? (
        <Trans>工程超过大小限制：最多 50 章，每章 5 MB，合计 20 MB。</Trans>
      ) : code === "write_failed" ? (
        <Trans>保存失败，原工程未被替换。请检查位置权限后重试。</Trans>
      ) : code === "read_failed" ? (
        <Trans>无法读取工程，请检查文件是否存在及访问权限。</Trans>
      ) : code === "invalid_format" || code === "invalid_project" ? (
        <Trans>工程格式无效，请选择完整的 .castglean 工程文件。</Trans>
      ) : (
        <Trans>操作未完成，请重试或选择其他文件位置。</Trans>
      )}
    </p>
  );
}
function FileFailureDialog({
  error,
  title,
  onDismiss,
  onRetry,
  retryLabel,
}: {
  error: unknown;
  title: ReactNode;
  onDismiss: () => void;
  onRetry: () => void;
  retryLabel: ReactNode;
}) {
  return (
    <Dialog
      open={!!error}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            <Trans>当前会话内容仍保留，请检查原因后重试。</Trans>
          </DialogDescription>
        </DialogHeader>
        <FileError error={error} />
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>
            <Trans comment="关闭文件操作错误提示，不清除当前工程">关闭</Trans>
          </DialogClose>
          <Button onClick={onRetry}>{retryLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function OpenProjectButton({
  fullWidth = false,
}: {
  fullWidth?: boolean;
}) {
  const { t } = useLingui();
  const { openProject } = usePreviewProjects();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function open(file?: File) {
    setBusy(true);
    setError(null);
    try {
      const project = await openProject(file);
      if (project)
        await navigate({ to: "/project/$id", params: { id: project.id } });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2",
        fullWidth && "w-full items-stretch",
      )}
    >
      <Button
        variant="outline"
        className={fullWidth ? "w-full justify-start" : undefined}
        disabled={busy}
        onClick={() => (desktop ? void open() : input.current?.click())}
      >
        {busy ? (
          <LoaderCircleIcon className="animate-spin" />
        ) : (
          <FolderOpenIcon />
        )}
        {busy ? (
          <Trans comment="读取并校验工程文件中">正在打开工程…</Trans>
        ) : (
          <Trans comment="选择并校验已保存的 CastGlean 工程文件">
            打开工程
          </Trans>
        )}
      </Button>
      {!desktop && (
        <input
          ref={input}
          type="file"
          accept=".castglean"
          className="hidden"
          aria-label={t({
            comment: "浏览器中选择工程文件",
            message: "选择工程文件",
          })}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void open(file);
          }}
        />
      )}
      {error ? (
        <FileFailureDialog
          error={error}
          title={<Trans>未能打开工程</Trans>}
          onDismiss={() => setError(null)}
          onRetry={() => {
            setError(null);
            if (desktop) void open();
            else input.current?.click();
          }}
          retryLabel={
            <Trans comment="文件操作失败后重新打开系统文件选择器">
              重新选择文件
            </Trans>
          }
        />
      ) : null}
    </div>
  );
}
export function SaveProjectButton({ project }: { project: PreviewProject }) {
  const { saveProject } = usePreviewProjects();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveProject(project.id);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void save()}
      >
        {busy ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />}
        {busy ? (
          <Trans comment="写入或导出工程文件中">正在保存工程…</Trans>
        ) : desktop ? (
          <Trans comment="系统保存对话框写入工程文件">保存工程</Trans>
        ) : (
          <Trans comment="浏览器下载可重新打开的工程文件">导出工程</Trans>
        )}
      </Button>
      {error ? (
        <FileFailureDialog
          error={error}
          title={<Trans>工程尚未保存</Trans>}
          onDismiss={() => setError(null)}
          onRetry={() => void save()}
          retryLabel={
            <Trans comment="重新尝试保存或导出当前工程">重试保存</Trans>
          }
        />
      ) : null}
    </div>
  );
}
export function ProjectFileStatus({ project }: { project: PreviewProject }) {
  return (
    <span role="status" title={project.fileState?.filename}>
      {project.fileState?.kind === "saved" ? (
        <Trans comment="宿主已成功写入或校验打开磁盘工程">已保存</Trans>
      ) : project.fileState?.kind === "exported" ? (
        <Trans comment="浏览器已触发文件下载，不保证下载完成">已发起导出</Trans>
      ) : project.fileState?.kind === "opened" ? (
        <Trans comment="已从用户选择的工程文件恢复会话">已打开</Trans>
      ) : (
        <Trans comment="新工程尚未写入工程文件">未保存</Trans>
      )}
    </span>
  );
}
