import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";
import { desktop } from "@/lib/local-projects";

/**
 * 文件拖入窗口的接收态。仅桌面端、仅挂载期间监听 Tauri 拖放事件；
 * 注册失败（事件不可用）静默降级为按钮导入，不向用户暴露底层异常。
 * 返回是否正有文件悬停在窗口上；松开的路径交给 onDrop。
 */
export function useDragImport(onDrop: (paths: string[]) => void) {
  const [dragging, setDragging] = useState(false);
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDragging(true);
          return;
        }
        if (payload.type === "drop") onDropRef.current(payload.paths);
        setDragging(false);
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // 事件监听不可用：保持按钮导入可用即可，不提示。
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return dragging;
}
