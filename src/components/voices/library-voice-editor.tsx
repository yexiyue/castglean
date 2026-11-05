import { Trans } from "@lingui/react/macro";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type LibraryVoiceFeedback =
  | "saving"
  | "deleting"
  | "saved"
  | "cancelled"
  | "save-error"
  | "delete-error";

export function LibraryVoiceEditor({
  name,
  savedName,
  busy = false,
  feedback = null,
  onNameChange,
  onSave,
  onReset,
  onDelete,
}: {
  name: string;
  savedName: string;
  busy?: boolean;
  feedback?: LibraryVoiceFeedback | null;
  onNameChange?: (name: string) => void;
  onSave?: () => void;
  onReset?: () => void;
  onDelete?: () => void;
}) {
  const formId = useId();
  const dirty = name.trim() !== savedName;
  const failed = feedback?.endsWith("-error");
  const valid = !!name.trim();
  return (
    <div className="space-y-5">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && dirty && valid) onSave?.();
        }}
      >
        <label htmlFor={formId} className="block text-sm font-medium">
          <Trans comment="编辑库内音色显示名称">音色名称</Trans>
        </label>
        <Input
          id={formId}
          value={name}
          disabled={busy || !onNameChange}
          aria-invalid={!valid}
          aria-describedby={!valid ? `${formId}-validation` : undefined}
          onChange={(event) => onNameChange?.(event.target.value)}
        />
        {!valid && (
          <p id={`${formId}-validation`} className="text-destructive text-sm">
            <Trans>请输入音色名称。</Trans>
          </p>
        )}
        <p className="text-muted-foreground text-sm">
          <Trans>只修改显示名称，音色身份和原始录音保持不变。</Trans>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={busy || !valid || !dirty || !onSave}
          >
            {feedback === "saving" ? (
              <Trans>正在保存名称…</Trans>
            ) : feedback === "save-error" ? (
              <Trans comment="重试保存音色的新名称">重试保存</Trans>
            ) : (
              <Trans comment="持久保存已有音色的新名称">保存名称</Trans>
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy || !dirty || !onReset}
            onClick={onReset}
          >
            <Trans comment="放弃尚未保存的音色名称修改">撤销修改</Trans>
          </Button>
        </div>
      </form>
      {feedback && (
        <p
          role={failed ? "alert" : "status"}
          className={
            failed
              ? "text-destructive text-sm leading-6"
              : "text-muted-foreground text-sm leading-6"
          }
        >
          {feedback === "saving" && <Trans>正在保存名称…</Trans>}
          {feedback === "saved" && <Trans>名称已保存。</Trans>}
          {feedback === "save-error" && (
            <Trans>
              名称未保存，输入已保留。请检查存储位置是否可写后重试。
            </Trans>
          )}
          {feedback === "deleting" && <Trans>等待系统确认或删除完成…</Trans>}
          {feedback === "cancelled" && (
            <Trans>已取消删除，音色仍保留在库中。</Trans>
          )}
          {feedback === "delete-error" && (
            <Trans>
              删除未完成。请等待试听、生成或导入导出任务结束后重试，并检查存储权限。
            </Trans>
          )}
        </p>
      )}
      <div className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-medium">
          <Trans comment="库内音色的永久删除操作">删除音色</Trans>
        </h3>
        <p className="text-muted-foreground text-sm leading-6">
          <Trans>
            删除会移除音色库中的原始录音，无法撤销。系统会再次要求确认。
          </Trans>
        </p>
        <Button
          size="sm"
          variant="destructive"
          disabled={busy || !onDelete}
          onClick={onDelete}
        >
          {feedback === "deleting" ? (
            <Trans comment="等待系统确认或音色删除结束">正在处理删除…</Trans>
          ) : feedback === "delete-error" ? (
            <Trans comment="重新尝试删除库内音色">重试删除</Trans>
          ) : (
            <Trans comment="打开系统确认后永久删除库内音色">删除音色…</Trans>
          )}
        </Button>
      </div>
    </div>
  );
}
