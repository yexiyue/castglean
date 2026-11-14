import type { LocalProjectSnapshot_Serialize, TextLine } from "@/lib/bindings";
import type { WorkspaceReader } from "@/lib/workspace/reader";

const sourceId = "sample-source";
const hash = "9f9b94c3a4787c43a9a23977ffb996f724efa4306b8d34df95b81e782ba21aed";
const text = [
  "第一章 夜航灯\n",
  "夜潮退去后，渡口的石阶露出一线湿亮的青色。\n",
  "“船不等人，灯也不能灭。”守灯人说。\n",
  "\n",
  "第二章 旧渡口\n",
  "天将亮时，阿岚带着旧航海图走向渡口。\n",
  "“等潮水涨起来，我们就出发。”\n",
];
const encoder = new TextEncoder();
let offset = 0;
const lines: TextLine[] = text.map((value, line) => {
  const start = offset;
  offset += encoder.encode(value).length;
  return { line, start, end: offset, text: value };
});
const project: LocalProjectSnapshot_Serialize = {
  id: "sample",
  title: "夜航灯",
  description: "",
  revision: 1,
  sources: [
    {
      id: sourceId,
      filename: "夜航灯.txt",
      encoding: "utf-8",
      sha256: hash,
      bytes: offset,
      lines: lines.length,
    },
  ],
  chapters: [
    {
      id: "sample-chapter-1",
      sourceId,
      title: "第一章 夜航灯",
      start: lines[0].start,
      end: lines[3].end,
      heading: 0,
      volumeId: null,
      predecessorIds: [],
    },
    {
      id: "sample-chapter-2",
      sourceId,
      title: "第二章 旧渡口",
      start: lines[4].start,
      end: lines[6].end,
      heading: 4,
      volumeId: null,
      predecessorIds: [],
    },
  ],
  volumes: [],
  corrections: [],
  rules: [],
  issues: [],
  canUndo: false,
};
function assertProject(id: string) {
  if (id !== project.id) throw new Error("sample_project_not_found");
}

export function createSampleProject(): LocalProjectSnapshot_Serialize {
  return structuredClone(project);
}

/** Isolated, read-only example data; no method calls the desktop host. */
export const sampleReader: WorkspaceReader = {
  readOnly: true,
  async localProjectSnapshot(id) {
    assertProject(id);
    return createSampleProject();
  },
  async localProjectText(id, requestedSource, line, count) {
    assertProject(id);
    if (
      requestedSource !== sourceId ||
      !Number.isInteger(line) ||
      line < 0 ||
      !Number.isInteger(count) ||
      count < 1
    )
      throw new Error("sample_source_not_found");
    const page = lines.slice(line, line + count);
    return {
      sourceId,
      sha256: hash,
      lines: structuredClone(page),
      nextLine: line + page.length < lines.length ? line + page.length : null,
    };
  },
  async chapterAnalysisSnapshot(id, chapterId) {
    assertProject(id);
    const chapter = project.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("sample_chapter_not_found");
    return {
      binding: {
        projectId: id,
        chapterId,
        sourceId,
        sha256: hash,
        start: chapter.start,
        end: chapter.end,
      },
      revision: 0,
      humanRevision: 0,
      versionId: null,
      stale: false,
      segmentCount: 0,
      pendingCount: 0,
      candidateIds: [],
      canUndo: false,
    };
  },
  async chapterAnalysisCharacters(id) {
    assertProject(id);
    return [];
  },
  async chapterAnalysisDirectory(id) {
    assertProject(id);
    return [];
  },
  async chapterAnalysisSegments(id) {
    assertProject(id);
    throw new Error("sample_analysis_not_available");
  },
  async chapterAnalysisIssues(id) {
    assertProject(id);
    return { issues: [], next: null };
  },
};
