import type { Chapter_Serialize } from "../bindings";

export type ChapterReadingRange = {
  startLine: number;
  endLine: number | null;
  startByte: number;
  endByte: number;
};
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
