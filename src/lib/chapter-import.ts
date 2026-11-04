import type { PreviewChapter } from "./preview-projects";

export type ImportIssueCode =
  | "format"
  | "empty"
  | "encoding"
  | "large"
  | "duplicate"
  | "limit"
  | "read";
export interface ImportIssue {
  id: string;
  filename: string;
  code: ImportIssueCode;
}
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_CHAPTERS = 50;

function chapterNumber(filename: string): number | undefined {
  if (/^\s*(序章|楔子|引子|前言|序言)/.test(filename)) return 0;
  const match = filename.match(
    /^\s*(?:第)?([0-9零〇一二两三四五六七八九十百千万]+)(?:章|回|节|卷|集|[ ._、-])/,
  );
  if (!match) return;
  const text = match[1];
  if (/^[0-9]+$/.test(text)) return Number(text);
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const units: Record<string, number> = {
    十: 10,
    百: 100,
    千: 1000,
    万: 10000,
  };
  if (!/[十百千万]/.test(text))
    return Number([...text].map((c) => digits[c]).join(""));
  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of text) {
    if (char in digits) number = digits[char];
    else if (char === "万") {
      total += (section + number) * 10000;
      section = 0;
      number = 0;
    } else {
      section += (number || 1) * units[char];
      number = 0;
    }
  }
  return total + section + number;
}

export function compareChapterFilenames(a: string, b: string) {
  const first = chapterNumber(a);
  const second = chapterNumber(b);
  if (first === undefined && second !== undefined) return 1;
  if (first !== undefined && second === undefined) return -1;
  if (first !== undefined && second !== undefined && first !== second)
    return first - second;
  return a.localeCompare(b, "zh-CN", { numeric: true });
}

/** Reads temporary preview text, without normalization, splitting, upload or persistence. */
export async function readChapterFiles(
  files: File[],
  existing: PreviewChapter[],
) {
  const chapters: PreviewChapter[] = [];
  const issues: ImportIssue[] = [];
  let totalBytes = existing.reduce((sum, chapter) => sum + chapter.bytes, 0);
  for (const file of [...files].sort((a, b) =>
    compareChapterFilenames(a.name, b.name),
  )) {
    const reject = (code: ImportIssueCode) =>
      issues.push({ id: crypto.randomUUID(), filename: file.name, code });
    if (!/\.txt$/i.test(file.name)) {
      reject("format");
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      reject("large");
      continue;
    }
    if (
      existing.length + chapters.length >= MAX_CHAPTERS ||
      totalBytes + file.size > MAX_TOTAL_BYTES
    ) {
      reject("limit");
      continue;
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      reject("read");
      continue;
    }
    let source: string;
    try {
      source = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
    } catch {
      reject("encoding");
      continue;
    }
    if (!source.trim()) {
      reject("empty");
      continue;
    }
    if (source.includes("\u0000")) {
      reject("encoding");
      continue;
    }
    if (
      [...existing, ...chapters].some((chapter) => chapter.source === source)
    ) {
      reject("duplicate");
      continue;
    }
    let characters = 0;
    for (const _character of source) characters++;
    chapters.push({
      id: crypto.randomUUID(),
      title: file.name.replace(/\.txt$/i, ""),
      filename: file.name,
      source,
      bytes: file.size,
      characters,
    });
    totalBytes += file.size;
  }
  return { chapters, issues };
}
