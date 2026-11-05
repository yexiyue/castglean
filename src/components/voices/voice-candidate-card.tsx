import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useId, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { CandidateView } from "@/lib/bindings";

export type CandidateAction = "save" | "remove";

export function VoiceCandidateCard({
  candidate,
  busy = false,
  action = null,
  failure = null,
  onPlay,
  onSave,
  onRemove,
  children,
}: {
  candidate: CandidateView;
  busy?: boolean;
  action?: CandidateAction | null;
  failure?: CandidateAction | null;
  onPlay?: () => void;
  onSave?: () => void;
  onRemove?: () => void;
  children?: ReactNode;
}) {
  const titleId = useId();
  const auditionId = useId();
  const [audition, setAudition] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const saved = !!candidate.saved_id;
  const disabled = busy || action !== null;
  return (
    <article aria-labelledby={titleId} className="min-w-0 rounded-md border">
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id={titleId} className="font-medium wrap-break-word">
            {candidate.voice.name}
          </h3>
          <p role="status" className="text-muted-foreground text-xs">
            {saved ? (
              <Trans comment="候选已经正式保存到音色库">已保存到音色库</Trans>
            ) : (
              <Trans comment="候选还未正式保存">尚未保存</Trans>
            )}
          </p>
        </div>
        <p className="text-muted-foreground text-sm leading-6 wrap-break-word whitespace-pre-wrap">
          {candidate.voice.transcript}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || !onPlay}
            onClick={onPlay}
          >
            <Trans comment="播放候选的原始音频，不运行模型">试听原始录音</Trans>
          </Button>
          {children && (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-expanded={audition}
              aria-controls={auditionId}
              onClick={() => setAudition(!audition)}
            >
              {audition ? (
                <Trans comment="收起候选的模型试听设置">收起模型试听</Trans>
              ) : (
                <Trans comment="展开使用其他文本生成试听的设置">
                  用模型试声
                </Trans>
              )}
            </Button>
          )}
        </div>
        {children && audition && (
          <div id={auditionId} className="border-t pt-4">
            {children}
          </div>
        )}
      </div>
      <div className="space-y-3 border-t px-4 py-3">
        {failure && (
          <p role="alert" className="text-destructive text-sm leading-6">
            {failure === "save" ? (
              <Trans>
                保存未完成，候选仍保留。请检查存储位置是否可写、空间是否充足后重试。
              </Trans>
            ) : (
              <Trans>
                移除未完成，候选仍保留。请等待相关试听任务结束后重试。
              </Trans>
            )}
          </p>
        )}
        {action && (
          <p role="status" className="text-muted-foreground text-sm">
            {action === "save" ? (
              <Trans comment="候选正在写入音色库">正在保存音色…</Trans>
            ) : (
              <Trans comment="候选正在释放与移除">正在移除候选…</Trans>
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {saved ? (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/voices" search={{ library: "mine" }} />}
            >
              <Trans comment="打开保存后的个人音色库">查看我的音色</Trans>
            </Button>
          ) : (
            <Button size="sm" disabled={disabled || !onSave} onClick={onSave}>
              {failure === "save" ? (
                <Trans comment="重新保存失败的音色候选">重试保存</Trans>
              ) : (
                <Trans comment="将候选正式加入个人音色库">保存到音色库</Trans>
              )}
            </Button>
          )}
          <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
            <AlertDialogTrigger
              render={<Button size="sm" variant="ghost" disabled={disabled} />}
            >
              <Trans comment="移除临时候选，不删除已经入库的音色">
                移除候选
              </Trans>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  <Trans>移除这个候选？</Trans>
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {saved ? (
                    <Trans>
                      只移除当前候选，已保存的音色仍保留在音色库中。
                    </Trans>
                  ) : (
                    <Trans>
                      这个候选尚未保存，移除后无法恢复。你也可以取消并先保存到音色库。
                    </Trans>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  <Trans comment="保留当前候选并关闭确认">保留候选</Trans>
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={disabled || !onRemove}
                  onClick={() => {
                    setConfirmRemove(false);
                    onRemove?.();
                  }}
                >
                  <Trans comment="确认释放和移除临时候选">确认移除</Trans>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </article>
  );
}
