import { mockIPC } from "@tauri-apps/api/mocks";
import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { useAiSession } from "../../src/hooks/use-ai-session";
import { useChapterAnalysis } from "../../src/hooks/use-chapter-analysis";
import { useChapterAnalysisIssues } from "../../src/hooks/use-chapter-analysis-issues";
import { useChapterAudio } from "../../src/hooks/use-chapter-audio";
import { DesktopSessionProvider } from "../../src/lib/desktop-session";
import { WorkspaceReaderContext } from "../../src/lib/workspace/reader";
import { sampleReader } from "../../src/lib/workspace/sample-reader";

(window as any).fixture = { calls: [] };
(window as any).isTauri = true;
mockIPC((command) => { (window as any).fixture.calls.push(command); throw new Error(`unexpected host call: ${command}`); });
function Harness() {
  const analysis = useChapterAnalysis("sample", "sample-chapter-1");
  const issues = useChapterAnalysisIssues("sample", null, 0, "");
  const audio = useChapterAudio("sample", "sample-chapter-1");
  const ai = useAiSession({ projectId: "sample", taskKind: "project_assistant", title: "sample", binding: () => null, failureText: "failed" });
  return <main>
    <output aria-label="analysis">{analysis.data?.snapshot.binding.chapterId ?? "loading"}</output>
    <output aria-label="issues">{issues.failed ? "failed" : issues.rows.length}</output>
    <output aria-label="audio">{String(audio.desktop)}</output>
    <output aria-label="ai">{ai.loading ? "loading" : "ready"}</output>
    <button type="button" onClick={() => void audio.start()}>start audio</button>
    <button type="button" onClick={() => void audio.cancel("run")}>cancel audio</button>
    <button type="button" onClick={() => void ai.send("hello").catch(() => {})}>send</button>
    <button type="button" onClick={() => void ai.refresh()}>refresh</button>
  </main>;
}
const rootRoute = createRootRoute({ component: () => <DesktopSessionProvider><WorkspaceReaderContext.Provider value={sampleReader}><Harness /></WorkspaceReaderContext.Provider></DesktopSessionProvider> });
const router = createRouter({ routeTree: rootRoute });
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
