import type { Chapter, Volume } from "../bindings";

export type ChapterChange = {
  key: string;
  kind: "added" | "removed" | "changed" | "unchanged";
  chapter: Chapter;
  before?: Chapter;
  after?: Chapter;
};
const boundary = (chapter: Chapter) =>
  JSON.stringify([chapter.sourceId, chapter.heading ?? null, chapter.start]);
const volumeIdentity = (volumes: Volume[]) =>
  new Map(
    volumes.map((volume) => [
      volume.id,
      JSON.stringify([volume.sourceId, volume.line, volume.title]),
    ]),
  );

/** Candidate ids may be regenerated: compare source boundaries and semantic values. */
export function chapterChanges(
  before: Chapter[],
  after: Chapter[],
  beforeVolumes: Volume[],
  afterVolumes: Volume[],
): ChapterChange[] {
  const beforeVolume = volumeIdentity(beforeVolumes);
  const afterVolume = volumeIdentity(afterVolumes);
  const previous = new Map(
    before.map((chapter) => [boundary(chapter), chapter]),
  );
  const result: ChapterChange[] = after.map((chapter) => {
    const key = boundary(chapter);
    const old = previous.get(key);
    previous.delete(key);
    return {
      key,
      chapter,
      before: old,
      after: chapter,
      kind: !old
        ? "added"
        : old.title !== chapter.title ||
            old.end !== chapter.end ||
            (beforeVolume.get(old.volumeId ?? "") ?? null) !==
              (afterVolume.get(chapter.volumeId ?? "") ?? null)
          ? "changed"
          : "unchanged",
    };
  });
  for (const [key, chapter] of previous)
    result.push({ key, chapter, before: chapter, kind: "removed" });
  const sourceOrder = new Map(
    Array.from(
      new Set([...before, ...after].map((chapter) => chapter.sourceId)),
      (id, index) => [id, index],
    ),
  );
  return result.sort((a, b) => {
    const left = a.chapter;
    const right = b.chapter;
    return (
      (sourceOrder.get(left.sourceId) ?? 0) -
        (sourceOrder.get(right.sourceId) ?? 0) || left.start - right.start
    );
  });
}
