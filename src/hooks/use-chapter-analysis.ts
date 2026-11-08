import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AnalysisSnapshot,
  type Character,
  commands,
  type DirectorySummary,
  type Segment,
} from "@/lib/bindings";

type Data = {
  snapshot: AnalysisSnapshot;
  characters: Character[];
  directory: DirectorySummary[];
};
/** Read projection only. Stale requests cannot replace another chapter's view. */
export function useChapterAnalysis(projectId: string, chapterId: string) {
  const [data, setData] = useState<Data | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [range, setRange] = useState<{ start: number; end: number } | null>(
    null,
  );
  const [failure, setFailure] = useState(false);
  const [readEpoch, setReadEpoch] = useState(0);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    try {
      const [snapshot, characters, directory] = await Promise.all([
        commands.chapterAnalysisSnapshot(projectId, chapterId),
        commands.chapterAnalysisCharacters(projectId),
        commands.chapterAnalysisDirectory(projectId),
      ]);
      if (request === generation.current) {
        setData({ snapshot, characters, directory });
        setReadEpoch((n) => n + 1);
        setFailure(false);
      }
    } catch {
      if (request === generation.current) setFailure(true);
      throw new Error("analysis_read_failed");
    }
  }, [projectId, chapterId]);
  useEffect(() => {
    setData(null);
    setSegments([]);
    setRange(null);
    void reload().catch(() => {});
    return () => {
      generation.current++;
    };
  }, [reload]);
  const version = data?.snapshot.versionId;
  useEffect(() => {
    let current = true;
    void readEpoch;
    if (!version || !range) {
      setSegments([]);
      return;
    }
    void (async () => {
      let after: number | null = null;
      const result: Segment[] = [];
      do {
        const page = await commands.chapterAnalysisSegments(
          projectId,
          version,
          range,
          after,
        );
        if (!current) return;
        result.push(...page.segments);
        after = page.nextStart;
      } while (after !== null);
      if (current) {
        setSegments(result);
        setFailure(false);
      }
    })().catch(() => {
      if (current) setFailure(true);
    });
    return () => {
      current = false;
    };
  }, [projectId, version, range, readEpoch]);
  const loadedRange = useCallback(
    (next: { start: number; end: number }) =>
      setRange((old) =>
        old?.start === next.start && old.end === next.end ? old : next,
      ),
    [],
  );
  return { data, segments, failure, reload, loadedRange };
}
