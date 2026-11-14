import type { Chapter_Serialize } from "../bindings";

export type ChapterReadingRange = {
  startLine: number;
  endLine: number | null;
  startByte: number;
  endByte: number;
};

/** Index headings once so issue lists can resolve many source lines efficiently. */
export function chapterLineIndex(chapters: Chapter_Serialize[]) {
  const bySource = new Map<string, Chapter_Serialize[]>();
  for (const chapter of chapters) {
    const list = bySource.get(chapter.sourceId) ?? [];
    list.push(chapter);
    bySource.set(chapter.sourceId, list);
  }
  for (const list of bySource.values())
    list.sort((a, b) => (a.heading ?? -1) - (b.heading ?? -1));
  return (sourceId: string, line: number) => {
    const list = bySource.get(sourceId) ?? [];
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((list[mid].heading ?? -1) <= line) lo = mid + 1;
      else hi = mid;
    }
    return list[lo - 1];
  };
}
export function chapterAtByte(
  chapters: Chapter_Serialize[],
  sourceId: string,
  byte: number,
) {
  return chapters.find(
    (chapter) =>
      chapter.sourceId === sourceId &&
      chapter.start <= byte &&
      byte < chapter.end,
  );
}
export function chapterReadingRange(
  chapters: Chapter_Serialize[],
  chapter: Chapter_Serialize,
): ChapterReadingRange {
  const next = chapters.find(
    (item) => item.sourceId === chapter.sourceId && item.start === chapter.end,
  );
  return {
    startLine: chapter.start === 0 ? 0 : (chapter.heading ?? 0),
    endLine: next?.heading ?? null,
    startByte: chapter.start,
    endByte: chapter.end,
  };
}
