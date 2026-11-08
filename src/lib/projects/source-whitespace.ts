import type { TextLine } from "../bindings";

export type SourceDisplay = "compact" | "original";
export type BlankRun = { from: number; to: number };
export function isBlankSourceLine(text: string) {
  return text.trim().length === 0;
}
export function blankRuns(lines: TextLine[]): BlankRun[] {
  const result: BlankRun[] = [];
  for (const line of lines) {
    if (!isBlankSourceLine(line.text)) continue;
    const last = result[result.length - 1];
    if (last?.to === line.line) last.to++;
    else result.push({ from: line.line, to: line.line + 1 });
  }
  return result;
}
export function mergeBlankRuns(runs: BlankRun[]): BlankRun[] {
  const result: BlankRun[] = [];
  for (const run of runs) {
    const last = result[result.length - 1];
    if (last?.to === run.from) last.to = run.to;
    else result.push({ ...run });
  }
  return result;
}
export function blankRunHeight(run: BlankRun) {
  return run.to - run.from === 1 ? 12 : 24;
}
