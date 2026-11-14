import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useBindingOperations } from "@/hooks/use-binding-operations";
import type { BindingSnapshot } from "@/lib/binding-operations";
import type { Character } from "@/lib/bindings";
import { characterDisplayLabel, voiceLabel } from "@/lib/voice-audition";

/** Kept above workspace panels so a pending operation remains recoverable after navigation. */
export function BindingRecovery({
  projectId,
  characters,
  onReconciled,
  onIdentityReconciled,
}: {
  projectId: string;
  characters: Character[];
  onReconciled: (snapshot: BindingSnapshot) => void;
  onIdentityReconciled: () => void;
}) {
  const { t } = useLingui();
  const operations = useBindingOperations(projectId);
  const callback = useRef(onReconciled);
  callback.current = onReconciled;
  const seen = useRef(0);
  const identityCallback = useRef(onIdentityReconciled);
  identityCallback.current = onIdentityReconciled;
  const seenIdentity = useRef(0);
  useEffect(() => {
    if (operations.completion !== seen.current && operations.latest) {
      seen.current = operations.completion;
      callback.current(operations.latest);
    }
  }, [operations, operations.completion]);
  useEffect(() => {
    if (operations.identityCompletion !== seenIdentity.current) {
      seenIdentity.current = operations.identityCompletion;
      identityCallback.current();
    }
  }, [operations, operations.identityCompletion]);
  const identity = operations.identityOperation;
  if (identity) {
    const target = characterDisplayLabel(
      characters,
      identity.characterId,
      t`未知角色`,
    );
    return (
      <div
        className="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs"
        role="status"
      >
        <div className="min-w-0 flex-1 wrap-anywhere">
          <Trans>角色身份目标：{target}</Trans>
          <span className="block">
            {identity.busy ? (
              <Trans>正在核对角色身份…</Trans>
            ) : identity.error === "prepare" ? (
              <Trans>无法读取影响范围，尚未提交；重试会先读取。</Trans>
            ) : identity.error === "read" ? (
              <Trans>身份修改已保存，重新读取状态失败。</Trans>
            ) : identity.error === "rejected" ? (
              <Trans>身份修改被拒绝或发生冲突，请重新读取后核对。</Trans>
            ) : (
              <Trans>
                身份修改结果尚未确认；重试沿用原操作，停止恢复不会撤销可能已保存的修改。
              </Trans>
            )}
          </span>
          {identity.abandonFailed && (
            <span className="text-destructive block">
              <Trans>重新读取失败，原操作仍保留。</Trans>
            </span>
          )}
        </div>
        {!identity.busy && identity.error !== "rejected" && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => void operations.resumeIdentity()}
          >
            {identity.phase === "read" ? (
              <Trans>重试读取身份</Trans>
            ) : (
              <Trans>重试原身份操作</Trans>
            )}
          </Button>
        )}
        {!identity.busy && identity.phase !== "read" && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void operations.abandonIdentity()}
          >
            <Trans>重新读取并停止恢复身份</Trans>
          </Button>
        )}
      </div>
    );
  }
  const profile = operations.profileOperation;
  if (profile) {
    const target =
      profile.target.kind === "narrator"
        ? t`旁白`
        : characterDisplayLabel(
            characters,
            profile.target.character_id,
            t`未知角色`,
          );
    return (
      <div
        className="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs"
        role="status"
      >
        <div className="min-w-0 flex-1 wrap-anywhere">
          <Trans>声音画像目标：{target}</Trans>
          <span className="block">
            {profile.busy ? (
              <Trans>正在核对声音画像…</Trans>
            ) : profile.error === "read" ? (
              <Trans>画像已保存，重新读取状态失败。</Trans>
            ) : profile.error === "rejected" ? (
              <Trans>画像保存被拒绝或发生冲突，请重新读取后核对。</Trans>
            ) : (
              <Trans>
                画像保存结果尚未确认，重试会沿用原操作；停止恢复不会撤销可能已保存的画像。
              </Trans>
            )}
          </span>
          {profile.abandonFailed && (
            <span className="text-destructive block">
              <Trans>重新读取失败，原操作仍保留。</Trans>
            </span>
          )}
        </div>
        {!profile.busy && profile.error !== "rejected" && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => void operations.resumeProfile()}
          >
            {profile.phase === "read" ? (
              <Trans>重试读取画像</Trans>
            ) : (
              <Trans>重试原画像操作</Trans>
            )}
          </Button>
        )}
        {!profile.busy && profile.phase !== "read" && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void operations.abandonProfile()}
          >
            <Trans>重新读取并停止恢复画像</Trans>
          </Button>
        )}
      </div>
    );
  }
  const op = operations.operation;
  if (!op) return null;
  const target =
    op.target.kind === "narrator"
      ? t`旁白`
      : characterDisplayLabel(characters, op.target.character_id, t`未知角色`);
  const voice = op.edit.type === "bind" ? voiceLabel(op.edit.voice) : null;
  return (
    <div
      className="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs"
      role="status"
    >
      <div className="min-w-0 flex-1 wrap-anywhere">
        {voice ? (
          <Trans>
            声音绑定目标：{target} · {voice}
          </Trans>
        ) : (
          <Trans>解除声音绑定：{target}</Trans>
        )}
        <span className="block">
          {op.busy ? (
            <Trans>正在核对声音绑定…</Trans>
          ) : op.error === "read" ? (
            <Trans>绑定已保存，重新读取状态失败。</Trans>
          ) : op.error === "rejected" ? (
            <Trans>绑定被拒绝或发生冲突，请重新读取后核对。</Trans>
          ) : op.error === "prepare" ? (
            <Trans>
              无法读取绑定所需状态，尚未提交；重试会读取后提交原操作。
            </Trans>
          ) : (
            <Trans>
              绑定结果尚未确认，重试会沿用原操作；停止恢复不会撤销可能已保存的绑定。
            </Trans>
          )}
        </span>
        {op.abandonFailed && (
          <span className="text-destructive block">
            <Trans>重新读取失败，原操作仍保留。</Trans>
          </span>
        )}
      </div>
      {!op.busy && op.error !== "rejected" && (
        <Button
          size="xs"
          variant="outline"
          onClick={() => void operations.resume()}
        >
          {op.phase === "read" ? (
            <Trans>重试读取</Trans>
          ) : op.phase === "prepare" ? (
            <Trans>重试提交操作</Trans>
          ) : (
            <Trans>重试原绑定操作</Trans>
          )}
        </Button>
      )}
      {!op.busy && op.phase !== "read" && (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void operations.abandon()}
        >
          {op.error === "unknown" ? (
            <Trans>重新读取并停止恢复</Trans>
          ) : (
            <Trans>重新读取并放弃原操作</Trans>
          )}
        </Button>
      )}
    </div>
  );
}
