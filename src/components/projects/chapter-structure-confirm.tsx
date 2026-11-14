import { Trans, useLingui } from "@lingui/react/macro";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export type ChapterBoundaryRequest = {
  projectId: string;
  projectTitle: string;
  chapterTitle: string;
  filename: string;
  line: number;
  include: boolean;
  revision: number;
  sourceId: string;
  commandId: string;
};

export function ChapterStructureConfirm({
  request,
  visible,
  pending,
  onCancel,
  onConfirm,
}: {
  request: ChapterBoundaryRequest | null;
  visible: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (request: ChapterBoundaryRequest) => void;
}) {
  const { t } = useLingui();
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={visible && !!request}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent initialFocus={cancel}>
        <DialogTitle>
          {request?.include ? t`从此行分章` : t`合并此章`}
        </DialogTitle>
        {request && (
          <div className="text-muted-foreground space-y-1 text-sm">
            <p>
              <Trans>工程：{request.projectTitle}</Trans>
            </p>
            <p>
              <Trans>章节：{request.chapterTitle}</Trans>
            </p>
            <p>
              <Trans>
                来源：{request.filename} · 第 {request.line + 1} 行
              </Trans>
            </p>
          </div>
        )}
        <p className="text-muted-foreground text-sm">
          <Trans>
            调整章节边界后，相关分析可能失效；历史与人工记录保留，不会自动迁移。
          </Trans>
        </p>
        <p className="text-muted-foreground text-sm">
          <Trans>历史音频会保留；边界变化后需要重新检查音频是否适用。</Trans>
        </p>
        <div className="flex justify-end gap-2">
          <Button ref={cancel} variant="outline" onClick={onCancel}>
            <Trans>取消</Trans>
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              if (request) onConfirm(request);
            }}
          >
            <Trans>确认调整</Trans>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
