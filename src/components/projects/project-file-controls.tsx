import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import { FolderOpenIcon, LoaderCircleIcon, SaveIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PreviewProject } from "@/lib/preview-projects";
import { usePreviewProjects } from "@/lib/preview-projects";
import { desktop } from "@/lib/project-files";
import { cn } from "@/lib/utils";

const invalidProjectMessage = msg`工程格式无效，请选择完整的 .castglean 工程文件。`;
const fileErrorMessages = new Map([
  ["checksum_mismatch", msg`正文校验失败，工程文件可能已损坏。请打开备份。`],
  [
    "unsupported_version",
    msg`暂不支持此工程版本，请使用匹配版本的 CastGlean。`,
  ],
  ["too_large", msg`工程超过大小限制：最多 10,000 章，正文合计 128 MiB。`],
  ["write_failed", msg`保存失败，原工程未被替换。请检查位置权限后重试。`],
  ["read_failed", msg`无法读取工程，请检查文件是否存在及访问权限。`],
  ["invalid_format", invalidProjectMessage],
  ["invalid_project", invalidProjectMessage],
]);

function FileError({ error }: { error: unknown }) {
  const { i18n } = useLingui();
  const message =
    typeof error === "string" ? fileErrorMessages.get(error) : undefined;
  return (
    <p role="alert" className="text-destructive max-w-sm text-xs leading-5">
      {i18n._(message ?? msg`操作未完成，请重试或选择其他文件位置。`)}
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
  iconOnly = false,
}: {
  fullWidth?: boolean;
  iconOnly?: boolean;
}) {
  const { t } = useLingui();
  const { openProject } = usePreviewProjects();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function open() {
    setBusy(true);
    setError(null);
    try {
      const project = await openProject();
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
        size={iconOnly ? "icon" : undefined}
        className={cn(
          iconOnly ? "size-10" : undefined,
          fullWidth ? "w-full justify-start" : undefined,
        )}
        aria-label={
          iconOnly
            ? t({
                comment: "应用侧栏打开工程图标按钮的无障碍名称",
                message: "打开工程",
              })
            : undefined
        }
        disabled={busy || !desktop}
        title={!desktop ? t`请在桌面应用中打开工程` : undefined}
        onClick={() => void open()}
      >
        {busy ? (
          <LoaderCircleIcon className="animate-spin" />
        ) : (
          <FolderOpenIcon />
        )}
        {!iconOnly &&
          (busy ? (
            <Trans comment="读取并校验工程文件中">正在打开工程…</Trans>
          ) : (
            <Trans comment="选择并校验已保存的 CastGlean 工程文件">
              打开工程
            </Trans>
          ))}
      </Button>
      {error ? (
        <FileFailureDialog
          error={error}
          title={<Trans>未能打开工程</Trans>}
          onDismiss={() => setError(null)}
          onRetry={() => {
            setError(null);
            void open();
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
        disabled={busy || !desktop}
        onClick={() => void save()}
      >
        {busy ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />}
        {busy ? (
          <Trans comment="宿主正在写入工程文件">正在保存工程…</Trans>
        ) : (
          <Trans comment="系统保存对话框写入工程文件">保存工程</Trans>
        )}
      </Button>
      {error ? (
        <FileFailureDialog
          error={error}
          title={<Trans>工程尚未保存</Trans>}
          onDismiss={() => setError(null)}
          onRetry={() => void save()}
          retryLabel={
            <Trans comment="重新尝试通过宿主保存当前工程">重试保存</Trans>
          }
        />
      ) : null}
    </div>
  );
}
export function ProjectFileStatus({ project }: { project: PreviewProject }) {
  return (
    <span role="status" title={project.fileState?.filename}>
      {project.fileState ? (
        <Trans comment="宿主已成功写入或校验打开磁盘工程">已保存</Trans>
      ) : (
        <Trans comment="新工程尚未写入工程文件">未保存</Trans>
      )}
    </span>
  );
}
