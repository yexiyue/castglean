import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnalysisSnapshot,
  Character,
  DirectorySummary,
  Segment,
} from "@/lib/bindings";
import { useWorkspaceReader } from "@/lib/workspace/reader";

type Data = {
  snapshot: AnalysisSnapshot;
  characters: Character[];
  directory: DirectorySummary[];
};
/** Read projection only. Stale requests cannot replace another chapter's view. */
export function useChapterAnalysis(projectId: string, chapterId: string) {
  const reader = useWorkspaceReader();
  const [data, setData] = useState<Data | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [range, setRange] = useState<{ start: number; end: number } | null>(
    null,
  );
  const [snapshotFailure, setSnapshotFailure] = useState(false);
  const [segmentFailure, setSegmentFailure] = useState(false);
  const [readEpoch, setReadEpoch] = useState(0);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    try {
      const [snapshot, characters, directory] = await Promise.all([
        reader.chapterAnalysisSnapshot(projectId, chapterId),
        reader.chapterAnalysisCharacters(projectId),
        reader.chapterAnalysisDirectory(projectId),
      ]);
      if (request === generation.current) {
        setData({ snapshot, characters, directory });
        setReadEpoch((n) => n + 1);
        setSnapshotFailure(false);
      }
    } catch {
      if (request === generation.current) setSnapshotFailure(true);
      throw new Error("analysis_read_failed");
    }
  }, [projectId, chapterId, reader]);
  useEffect(() => {
    setData(null);
    setSegments([]);
    setRange(null);
    setSnapshotFailure(false);
    setSegmentFailure(false);
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
        const page = await reader.chapterAnalysisSegments(
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
        setSegmentFailure(false);
      }
    })().catch(() => {
      if (current) setSegmentFailure(true);
    });
    return () => {
      current = false;
    };
  }, [projectId, version, range, readEpoch, reader]);
  const loadedRange = useCallback(
    (next: { start: number; end: number }) =>
      setRange((old) =>
        old?.start === next.start && old.end === next.end ? old : next,
      ),
    [],
  );
  return {
    data,
    segments,
    failure: snapshotFailure || segmentFailure,
    reload,
    loadedRange,
  };
}
