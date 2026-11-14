import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useChapterAnalysis } from "../../src/hooks/use-chapter-analysis";
import { WorkspaceReaderContext, type WorkspaceReader } from "../../src/lib/workspace/reader";
import { sampleReader } from "../../src/lib/workspace/sample-reader";

const fixture = { fail: false, release: undefined as (() => void) | undefined };
(window as any).fixture = fixture;
const reader: WorkspaceReader = {
  ...sampleReader,
  async chapterAnalysisSnapshot(...args) {
    if (fixture.fail) throw new Error("snapshot unavailable");
    return { ...(await sampleReader.chapterAnalysisSnapshot(...args)), versionId: "version-1" };
  },
  chapterAnalysisSegments() {
    return new Promise((resolve) => { fixture.release = () => resolve({ segments: [], nextStart: null }); });
  },
};
function Harness() {
  const analysis = useChapterAnalysis("sample", "sample-chapter-1");
  useEffect(() => analysis.loadedRange({ start: 0, end: 10 }), [analysis.loadedRange]);
  return <main><output aria-label="failure">{String(analysis.failure)}</output><button type="button" onClick={() => void analysis.reload().catch(() => {})}>reload</button></main>;
}
createRoot(document.getElementById("root")!).render(<WorkspaceReaderContext.Provider value={reader}><Harness /></WorkspaceReaderContext.Provider>);
