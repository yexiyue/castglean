import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "@tanstack/react-router";
import { HeadphonesIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { AppState } from "@/components/app-state";
import { ImportedWorkspace } from "@/components/projects/imported-workspace";
import {
  type ReadingLocation,
  WorkspaceModeContext,
  type WorkspaceSection,
} from "@/components/projects/workspace-mode";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { LocalProjectSnapshot_Serialize } from "@/lib/bindings";
import { useWorkspaceState } from "@/lib/desktop-session";
import { useLocalProjects } from "@/lib/local-projects";
import { useWorkspaceReader } from "@/lib/workspace/reader";

export function ProjectWorkspace({
  project: initial,
  section = "chapters",
  onAddSources,
  onChange,
}: {
  project: LocalProjectSnapshot_Serialize;
  section?: WorkspaceSection;
  onAddSources?: () => void;
  onChange?: (next: LocalProjectSnapshot_Serialize) => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { upsertProject } = useLocalProjects();
  const reader = useWorkspaceReader();
  const [project, setProject] = useState(initial);
  const latestProject = useRef(project);
  latestProject.current = project;
  const [location, setLocation] = useWorkspaceState<ReadingLocation | null>(
    initial.id,
    "productionLocation",
    null,
  );
  const results = section === "results";
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => setProject(initial), [initial]);
  // Refresh the host revision before editing a restored workspace.
  useEffect(() => {
    let live = true;
    void refresh;
    void reader
      .localProjectSnapshot(project.id)
      .then((next) => {
        if (!live) return;
        if (next.revision >= latestProject.current.revision) {
          setProject(next);
          if (!reader.readOnly) upsertProject(next);
        }
        setRefreshFailed(false);
      })
      .catch(() => {
        if (live) setRefreshFailed(true);
      });
    return () => {
      live = false;
    };
  }, [project.id, refresh, upsertProject, reader]);
  function capture() {
    const main = root.current?.querySelector<HTMLElement>("main");
    const viewport = main?.querySelector<HTMLElement>(
      '[data-slot="source-scroll"]',
    );
    if (!main || !viewport?.clientHeight) return;
    const top = viewport.getBoundingClientRect().top;
    const row = Array.from(
      viewport.querySelectorAll<HTMLElement>("[data-source-row]"),
    ).find((row) => row.getBoundingClientRect().bottom > top);
    if (row && main.dataset.sourceId && main.dataset.chapterId)
      setLocation({
        chapterId: main.dataset.chapterId,
        sourceId: main.dataset.sourceId,
        line: Number(row.dataset.sourceRow),
        offset: row.getBoundingClientRect().top - top,
        byte: Number(row.dataset.sourceByte ?? main.dataset.chapterByte ?? 0),
      });
  }
  async function navigateSection(next: WorkspaceSection) {
    if (next === section || (next === "characters" && !project.chapters.length))
      return;
    capture();
    await navigate({
      to: ".",
      search: (previous) => ({ ...previous, section: next }),
    });
  }
  function changed(next: LocalProjectSnapshot_Serialize) {
    if (reader.readOnly) return;
    if (
      next.id !== latestProject.current.id ||
      next.revision < latestProject.current.revision
    )
      return;
    latestProject.current = next;
    setProject(next);
    upsertProject(next);
    onChange?.(next);
  }
  return (
    <SidebarProvider
      ref={root}
      data-slot="project-workspace"
      className="h-full min-h-0 flex-1 overflow-hidden bg-sidebar"
      style={{ "--sidebar-width": "3.5rem" } as CSSProperties}
    >
      <AppSidebar
        section={section}
        onSectionChange={(next) => void navigateSection(next)}
      />
      <div
        data-slot="project-workspace-surface"
        className="isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden workspace-surface"
      >
        {refreshFailed && (
          <div
            role="alert"
            className="flex shrink-0 items-center gap-2 border-b px-3 py-1 text-xs text-destructive"
          >
            <Trans>
              无法更新工程状态，已有内容保留。请重新读取后继续编辑。
            </Trans>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRefresh((n) => n + 1)}
            >
              <Trans>重新读取</Trans>
            </Button>
          </div>
        )}
        {results && (
          <main className="flex min-h-0 flex-1 flex-col">
            <AppState
              icon={HeadphonesIcon}
              title={t`音频制作`}
              description={
                reader.readOnly
                  ? t`示例不含音频；请在真实工程中生成、试听并导出。`
                  : t`在章节制作中选择声音、生成和试听音频，并导出 WAV。跨章节结果列表尚未提供。`
              }
              actions={
                <Button
                  variant="outline"
                  onClick={() => void navigateSection("chapters")}
                >
                  <Trans>返回章节制作</Trans>
                </Button>
              }
            />
          </main>
        )}
        <div
          className={results ? "hidden" : "flex min-h-0 flex-1 flex-col"}
          inert={results}
        >
          <WorkspaceModeContext.Provider
            value={{
              active: !results,
              location,
              section,
              navigateSection,
            }}
          >
            {project.chapters.length ? (
              <ImportedWorkspace
                project={project}
                onChange={changed}
                onAddSources={
                  onAddSources ??
                  (() => {
                    void navigate({
                      to: "/new",
                      search: { draft: project.id, append: true },
                    });
                  })
                }
              />
            ) : (
              <AppState
                title={t`暂无章节`}
                description={t`导入原文后，在这里检查分章和人物归属。`}
                actions={
                  <Button
                    onClick={
                      onAddSources ??
                      (() => {
                        void navigate({
                          to: "/new",
                          search: { draft: project.id, append: true },
                        });
                      })
                    }
                  >
                    <Trans>追加原文文件</Trans>
                  </Button>
                }
              />
            )}
          </WorkspaceModeContext.Provider>
        </div>
      </div>
    </SidebarProvider>
  );
}
