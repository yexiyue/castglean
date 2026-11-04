import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { commands, events } from "@/lib/bindings";
import type { ModelEntry, ResourceState } from "@/lib/models";

export type ModelResources = {
  entries: ModelEntry[];
  /** 首次快照是否仍在加载（之后静默刷新，不整体置 loading）。 */
  loading: boolean;
  /** 快照或订阅失败；服务未就绪不是错误，页面按空目录展示。 */
  error: string | null;
  refresh: () => Promise<void>;
};

/**
 * 模型目录快照 + 引擎事件流：进度/状态事件合并进对应条目，
 * 不轮询。刷新合并宿主任务视图；应用重启后回归磁盘盘点。
 */
export function useModelResources(): ModelResources {
  const [entries, setEntries] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const updates = useRef(new Map<string, ResourceState>());

  const refresh = useCallback(async () => {
    const current = ++version.current;
    updates.current.clear();
    try {
      const next = await commands.listModels();
      if (current === version.current) {
        setEntries(
          next.map((entry) => ({
            ...entry,
            resource:
              updates.current.get(`${entry.backend}/${entry.model}`) ??
              entry.resource,
          })),
        );
        setError(null);
      }
    } catch (cause) {
      if (current === version.current) {
        setError(String(cause));
      }
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void events.modelResourceEvent
      .listen((event) => {
        if (!active) return;
        const {
          backend,
          model,
          state,
          downloaded_bytes,
          total_bytes,
          current_file,
        } = event.payload;
        let next: ResourceState | null = state ?? null;
        if (!next && downloaded_bytes != null) {
          next = {
            Downloading: {
              downloaded_bytes,
              total_bytes: total_bytes ?? 0,
              current_file: current_file ?? null,
            },
          };
        }
        if (!next) return;
        updates.current.set(`${backend}/${model}`, next);
        setEntries((previous) =>
          previous.map((entry) =>
            entry.backend === backend && entry.model === model
              ? { ...entry, resource: next }
              : entry,
          ),
        );
      })
      .then((stop) => {
        if (active) {
          unlisten = stop;
          void refresh();
        } else {
          stop();
        }
      })
      .catch((cause) => {
        if (active) {
          setError(String(cause));
          setLoading(false);
        }
      });
    return () => {
      active = false;
      version.current += 1;
      unlisten?.();
    };
  }, [refresh]);

  return useMemo(
    () => ({ entries, loading, error, refresh }),
    [entries, loading, error, refresh],
  );
}
