// Public source text for exercising the production route's reader; byte ranges are UTF-8.
export function whitespaceRouteFixture(longBlank: boolean) {
  const encoder = new TextEncoder();
  const rows: Record<string, { line: number; start: number; end: number; text: string }[]> = {};
  for (const [source, count] of [["source", longBlank ? 600 : 180], ["source-2", 450]] as const) {
    let byte = 0;
    rows[source] = Array.from({ length: count }, (_, line) => {
      const blank = source === "source-2" || line === 4 || (line >= 27 && line <= (longBlank ? 499 : 65)) || line === 67 || (line >= 87 && line <= 89);
      const text = blank ? ["\r\n", "　\t \r\n", "\u00a0\r\n"][line % 3] : line === 3 ? "　　段首中文🌲与 emoji🙂，保留缩进。\r\n" : line === 68 ? "　山有木兮，\r\n" : line === 69 ? "　木有枝。\r\n" : line === 70 ? "| A | B |\r\n" : line === 71 ? "| 1 | 2 |\r\n" : `第 ${line + 1} 行 山风穿过松林，星光照亮归途。\r\n`;
      const start = byte; byte += encoder.encode(text).length;
      return { line, start, end: byte, text };
    });
  }
  const cut = longBlank ? 510 : 90;
  const chapter = (id: string, sourceId: string, title: string, heading: number | null, start: number, end: number) => ({ id, sourceId, title, heading, start, end, volumeId: null, predecessorIds: [] });
  const project = { id: "fixture-project", title: "空白验收", description: "", revision: 1,
    sources: [{ id: "source", filename: "公开样本.txt", sha256: "a".repeat(64), bytes: rows.source.at(-1)!.end }, { id: "source-2", filename: "全空白公开样本.txt", sha256: "b".repeat(64), bytes: rows["source-2"].at(-1)!.end }],
    chapters: [chapter("whitespace-one", "source", "第一章 空白校对", 0, 0, rows.source[cut].start), chapter("whitespace-two", "source", "第二章 原样查看", cut, rows.source[cut].start, rows.source.at(-1)!.end), chapter("whitespace-empty", "source-2", "空白章节", null, 0, rows["source-2"].at(-1)!.end)], volumes: [], rules: [], corrections: [], issues: [], canUndo: false };
  return { rows, project };
}

export function continuousRouteFixture() {
  const encoder = new TextEncoder();
  let byte = 0;
  const source = Array.from({ length: 3000 }, (_, line) => {
    const text = line === 29 ? "边界原文🌲，前一块的结尾。\r\n" : line === 30 ? "\r\n" : line === 31 ? "下一块中文🙂，保持原文。\r\n" : `第 ${line + 1} 行 ` + (line % 37 === 12 ? "山风穿过长街，远处的灯火渐渐亮了起来。".repeat(25) : "山风穿过松林，星光照亮归途。") + "\r\n";
    const start = byte; byte += encoder.encode(text).length;
    return { line, start, end: byte, text };
  });
  const chapter = (id: string, title: string, heading: number, end: number) => ({ id, sourceId: "source", title, heading, start: source[heading].start, end, volumeId: null, predecessorIds: [] });
  const project = { id: "fixture-project", title: "连续阅读验收", description: "", revision: 1,
    sources: [{ id: "source", filename: "公开长样本.txt", sha256: "a".repeat(64), bytes: byte }],
    chapters: [chapter("continuous-one", "第一章 连续阅读", 0, source[1500].start), chapter("continuous-two", "第二章 连续阅读", 1500, byte)], volumes: [], rules: [], corrections: [], issues: [], canUndo: false };
  return { rows: { source }, project };
}

export function chapteredRouteFixture() {
  const encoder = new TextEncoder();
  const rows: Record<string, { line: number; start: number; end: number; text: string }[]> = {};
  for (const [source, count] of [["source", 76], ["source-2", 8]] as const) {
    let byte = 0;
    rows[source] = Array.from({ length: count }, (_, line) => {
      const text = `${source} 行 ${line + 1} 中文🌲🙂 ` + (line % 17 === 9 ? "长段落保持当前章节，不能自动越过边界。".repeat(25) : "山风吹过松林。") + "\r\n";
      const start = byte; byte += encoder.encode(text).length;
      return { line, start, end: byte, text };
    });
  }
  const chapter = (id: string, sourceId: string, title: string, heading: number | null, start: number, end: number) => ({ id, sourceId, title, heading, start, end, volumeId: null, predecessorIds: [] });
  const source = rows.source, other = rows["source-2"];
  const project = { id: "fixture-project", title: "章节边界验收", description: "", revision: 1,
    sources: [{ id: "source", filename: "公开样本.txt", sha256: "a".repeat(64), bytes: source.at(-1)!.end }, { id: "source-2", filename: "第二份公开样本.txt", sha256: "b".repeat(64), bytes: other.at(-1)!.end }],
    chapters: [chapter("preface", "source", "前置内容", null, 0, source[3].start), chapter("chapter-one", "source", "第一章 山雨", 3, source[3].start, source[73].start), chapter("chapter-two", "source", "第二章 来客", 73, source[73].start, source.at(-1)!.end), chapter("chapter-file", "source-2", "第二份原文", null, 0, other.at(-1)!.end)], volumes: [], rules: [], corrections: [], issues: [{ sourceId: "source", line: 74, kind: "numbering_gap" }], canUndo: false };
  return { rows, project };
}
