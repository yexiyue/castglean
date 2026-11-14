import { useCallback, useEffect, useRef, useState } from "react";
import type { Issue, IssueCursor } from "@/lib/bindings";
import { useWorkspaceReader } from "@/lib/workspace/reader";

export function useChapterAnalysisIssues(
  projectId: string,
  chapterId: string | null,
  revision: number,
  search: string,
) {
  const reader = useWorkspaceReader();
  const [rows, setRows] = useState<Issue[]>([]);
  const [next, setNext] = useState<IssueCursor | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const id = ++generation.current;
    busy.current = true;
    setRows([]);
    setNext(null);
    setFailed(false);
    void revision;
    void reloadKey;
    void reader
      .chapterAnalysisIssues(projectId, chapterId, null, search)
      .then((page) => {
        if (id === generation.current) {
          setRows(page.issues);
          setNext(page.next);
        }
      })
      .catch(() => {
        if (id === generation.current) setFailed(true);
      })
      .finally(() => {
        if (id === generation.current) busy.current = false;
      });
    return () => {
      generation.current++;
    };
  }, [projectId, chapterId, revision, search, reloadKey, reader]);
  const loadMore = useCallback(async () => {
    if (!next || busy.current) return;
    const id = generation.current;
    busy.current = true;
    try {
      const page = await reader.chapterAnalysisIssues(
        projectId,
        chapterId,
        next,
        search,
      );
      if (id === generation.current) {
        setRows((old) => [...old, ...page.issues]);
        setNext(page.next);
        setFailed(false);
      }
    } catch {
      if (id === generation.current) setFailed(true);
    } finally {
      if (id === generation.current) busy.current = false;
    }
  }, [projectId, chapterId, next, search, reader]);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  return {
    rows,
    hasMore: next !== null,
    loadMore,
    failed,
    reload,
  };
}
