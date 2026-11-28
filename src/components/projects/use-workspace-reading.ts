import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Chapter_Serialize } from "@/lib/bindings";
import {
  chapterAtByte,
  chapterReadingRange,
} from "@/lib/projects/chapter-reading";
import type { ReadingLocation } from "./workspace-mode";

export function useWorkspaceReading(
  chapters: Chapter_Serialize[],
  chapter: Chapter_Serialize,
) {
  const viewport = useRef<HTMLDivElement>(null);
  const reading = useMemo(
    () => chapterReadingRange(chapters, chapter),
    [chapters, chapter],
  );
  const [locatedLine, setLocatedLine] = useState(0);
  const [target, setTarget] = useState({ line: 0, offset: 44, version: 0 });
  const jumpToLine = useCallback((line: number, offset?: number) => {
    setTarget((previous) => ({
      line,
      offset: offset ?? previous.offset,
      version: previous.version + 1,
    }));
  }, []);
  return {
    viewport,
    reading,
    locatedLine,
    setLocatedLine,
    targetLine: target.line,
    targetOffset: target.offset,
    reloadKey: target.version,
    jumpToLine,
  };
}

/** Restore a reading location, including handoffs that require switching chapters first. */
export function useReadingHandoff({
  visible,
  location,
  chapters,
  chapter,
  readingStart,
  selectChapter,
  jumpToLine,
  setLocatedLine,
}: {
  visible: boolean;
  location: ReadingLocation | null;
  chapters: Chapter_Serialize[];
  chapter: Chapter_Serialize;
  readingStart: number;
  selectChapter: (id: string) => void;
  jumpToLine: (line: number, offset: number) => void;
  setLocatedLine: (line: number) => void;
}) {
  const pendingLocation = useRef<{
    location: ReadingLocation;
    chapterId: string;
  } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The shared anchor is captured on departure; apply it only on activation.
  useEffect(() => {
    if (!visible || !location) return;
    const next =
      chapterAtByte(chapters, location.sourceId, location.byte) ??
      chapters.find((c) => c.id === location.chapterId);
    if (!next) return;
    if (next.id !== chapter.id) {
      pendingLocation.current = {
        location,
        chapterId: next.id,
      };
      selectChapter(next.id);
    } else {
      const line = Math.max(readingStart, location.line);
      jumpToLine(line, location.offset);
      setLocatedLine(line);
    }
  }, [visible]);
  // Chapter changes reset the reader above; finish a cross-chapter handoff afterwards.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Chapter identity can change even when its source and start line are identical.
  useEffect(() => {
    const target = pendingLocation.current;
    if (!target || chapter.id !== target.chapterId) return;
    pendingLocation.current = null;
    const line = Math.max(readingStart, target.location.line);
    jumpToLine(line, target.location.offset);
    setLocatedLine(line);
  }, [chapter.id, chapter.sourceId, readingStart]);

  return function rememberLocation(target: ReadingLocation) {
    pendingLocation.current = { chapterId: target.chapterId, location: target };
  };
}
