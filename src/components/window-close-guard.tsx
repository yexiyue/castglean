import { Trans } from "@lingui/react/macro";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { commands, events } from "@/lib/bindings";
import { useDesktopSession } from "@/lib/desktop-session";
import { useLocalProjects } from "@/lib/local-projects";

/** All native close/quit requests reach the host boundary, including the traffic lights. */
export function WindowCloseGuard() {
  const { draft, pendingSources } = useLocalProjects();
  const {
    canCloseAll,
    hasPendingCandidateOperations,
    hasPendingBindingOperations,
    hasPendingSegmentEdits,
    hasUnsavedVoiceEdits,
    hasPendingStudioOperations,
    hasPendingAiStarts,
    hasUnsavedConnectionSettings,
    hasUnsavedStructure,
  } = useDesktopSession();
  const unsaved = !!(
    draft.title.trim() ||
    draft.description.trim() ||
    pendingSources
  );
  const latestUnsaved = useRef(unsaved);
  useEffect(() => {
    latestUnsaved.current = unsaved;
  }, [unsaved]);
  const pending = useRef(false);
  const [context, setContext] = useState<{
    unsaved: boolean;
    tasks: number;
    pendingCandidate: boolean;
    pendingBinding: boolean;
    pendingSegment: boolean;
    unsavedVoice: boolean;
    pendingStudio: boolean;
    pendingAi: boolean;
    unsavedConnection: boolean;
    unsavedStructure: boolean;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void events.windowCloseRequested
      .listen(async () => {
        if (disposed || pending.current) return;
        pending.current = true;
        setFailed(false);
        try {
          if (!(await canCloseAll())) {
            pending.current = false;
            return;
          }
          const snapshot = await commands.windowCloseContext();
          if (disposed) return;
          const next = {
            unsaved: latestUnsaved.current,
            tasks: snapshot.active_tasks,
            pendingCandidate: hasPendingCandidateOperations(),
            pendingBinding: hasPendingBindingOperations(),
            pendingSegment: hasPendingSegmentEdits(),
            unsavedVoice: hasUnsavedVoiceEdits(),
            pendingStudio: hasPendingStudioOperations(),
            pendingAi: hasPendingAiStarts(),
            unsavedConnection: hasUnsavedConnectionSettings(),
            unsavedStructure: hasUnsavedStructure(),
          };
          if (
            !next.unsaved &&
            !next.tasks &&
            !next.pendingCandidate &&
            !next.pendingBinding &&
            !next.pendingSegment &&
            !next.unsavedVoice &&
            !next.pendingStudio &&
            !next.pendingAi &&
            !next.unsavedConnection &&
            !next.unsavedStructure
          ) {
            await commands.confirmWindowClose();
          } else setContext(next);
        } catch {
          if (!disposed) {
            setFailed(true);
            setContext({
              unsaved: latestUnsaved.current,
              tasks: 0,
              pendingCandidate: hasPendingCandidateOperations(),
              pendingBinding: hasPendingBindingOperations(),
              pendingSegment: hasPendingSegmentEdits(),
              unsavedVoice: hasUnsavedVoiceEdits(),
              pendingStudio: hasPendingStudioOperations(),
              pendingAi: hasPendingAiStarts(),
              unsavedConnection: hasUnsavedConnectionSettings(),
              unsavedStructure: hasUnsavedStructure(),
            });
          }
        }
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch(() => {
        if (!disposed) {
          setFailed(true);
          setContext({
            unsaved: latestUnsaved.current,
            tasks: 0,
            pendingCandidate: hasPendingCandidateOperations(),
            pendingBinding: hasPendingBindingOperations(),
            pendingSegment: hasPendingSegmentEdits(),
            unsavedVoice: hasUnsavedVoiceEdits(),
            pendingStudio: hasPendingStudioOperations(),
            pendingAi: hasPendingAiStarts(),
            unsavedConnection: hasUnsavedConnectionSettings(),
            unsavedStructure: hasUnsavedStructure(),
          });
        }
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [
    canCloseAll,
    hasPendingCandidateOperations,
    hasPendingBindingOperations,
    hasPendingSegmentEdits,
    hasUnsavedVoiceEdits,
    hasPendingStudioOperations,
    hasPendingAiStarts,
    hasUnsavedConnectionSettings,
    hasUnsavedStructure,
  ]);
  async function confirm() {
    setClosing(true);
    try {
      await commands.confirmWindowClose();
    } catch {
      setFailed(true);
      setClosing(false);
    }
  }
  return (
    <AlertDialog
      open={context !== null}
      onOpenChange={(open) => {
        if (!open && !closing) {
          pending.current = false;
          setContext(null);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <Trans comment="确认关闭整个应用窗口的对话框标题">
              关闭 CastGlean？
            </Trans>
          </AlertDialogTitle>
          <AlertDialogDescription>
            {context?.unsaved && (
              <span className="block">
                <Trans>
                  尚有未提交的新建信息，关闭后这些信息可能丢失。已提交的本地工程会保留。
                </Trans>
              </span>
            )}
            {!!context?.tasks && (
              <span className="block">
                <Trans>
                  后台任务尚未结束，关闭后任务将停止；已保存的音色和文件会保留。
                </Trans>
              </span>
            )}
            {context?.pendingCandidate && (
              <span className="block">
                <Trans>
                  候选操作尚未完成恢复；关闭后将无法按原操作身份继续核对。
                </Trans>
              </span>
            )}
            {context?.pendingBinding && (
              <span className="block">
                <Trans>
                  角色资料有未保存草稿或待核对操作；关闭后草稿及原操作身份可能丢失。
                </Trans>
              </span>
            )}
            {context?.pendingSegment && (
              <span className="block">
                <Trans>
                  片段修改尚未完成核对；关闭后将无法按原操作身份继续恢复。
                </Trans>
              </span>
            )}
            {context?.unsavedVoice && (
              <span className="block">
                <Trans>
                  音色修改尚未保存或确认。关闭后草稿和本次会话的恢复凭据会丢失，无法安全重试原操作。
                </Trans>
              </span>
            )}
            {context?.pendingStudio && (
              <span className="block">
                <Trans>
                  声音配置草稿或任务请求尚未完成，关闭后草稿及原请求身份可能丢失。
                </Trans>
              </span>
            )}
            {context?.pendingAi && (
              <span className="block">
                <Trans>
                  助手请求尚未核对；关闭后本次请求身份会丢失，无法继续按原身份恢复。
                </Trans>
              </span>
            )}
            {context?.unsavedConnection && (
              <span className="block">
                <Trans>
                  设置草稿或保存结果尚未确认；关闭后草稿、密钥输入及原请求身份会丢失。
                </Trans>
              </span>
            )}
            {context?.unsavedStructure && (
              <span className="block">
                <Trans>
                  章节结构草稿或修改结果尚未确认；关闭后草稿和本次恢复身份会丢失。
                </Trans>
              </span>
            )}
            {failed && (
              <span role="alert" className="text-destructive block">
                <Trans>无法完成窗口操作。请取消后重试。</Trans>
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={closing}>
            <Trans comment="取消关闭应用，返回工作台">继续使用</Trans>
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={closing || failed}
            onClick={() => void confirm()}
          >
            <Trans comment="确认丢弃未保存会话并停止任务，关闭整个应用窗口">
              仍然关闭
            </Trans>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
