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
import { useLocalProjects } from "@/lib/local-projects";

/** All native close/quit requests reach the host boundary, including the traffic lights. */
export function WindowCloseGuard() {
  const { draft, pendingSources } = useLocalProjects();
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
          const snapshot = await commands.windowCloseContext();
          if (disposed) return;
          const next = {
            unsaved: latestUnsaved.current,
            tasks: snapshot.active_tasks,
          };
          if (!next.unsaved && !next.tasks) {
            await commands.confirmWindowClose();
          } else setContext(next);
        } catch {
          if (!disposed) {
            setFailed(true);
            setContext({ unsaved: latestUnsaved.current, tasks: 0 });
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
          setContext({ unsaved: latestUnsaved.current, tasks: 0 });
        }
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
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
