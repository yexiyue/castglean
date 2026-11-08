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
} from "@/components/projects/workspace-mode";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
import { commands, type LocalProjectSnapshot_Serialize } from "@/lib/bindings";
import { useDesktopSession, useWorkspaceState } from "@/lib/desktop-session";
import { useLocalProjects } from "@/lib/local-projects";

export function ProjectWorkspace({
  project: initial,
  section = "chapters",
  onAddSources,
  onChange,
}: {
  project: LocalProjectSnapshot_Serialize;
  section?: "chapters" | "characters" | "results";
  onAddSources?: () => void;
  onChange?: (next: LocalProjectSnapshot_Serialize) => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { workspace } = useDesktopSession();
  const { upsertProject } = useLocalProjects();
  const [project, setProject] = useState(initial);
  const latestProject = useRef(project);
  latestProject.current = project;
  const [location, setLocation] = useWorkspaceState<ReadingLocation | null>(
    initial.id,
    "productionLocation",
    null,
  );
  const [charactersRequest, setCharactersRequest] = useState(0);
  const [results, setResults] = useState(section === "results");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => setProject(initial), [initial]);
  // Refresh the host revision before editing a restored workspace.
  useEffect(() => {
    let live = true;
    void refresh;
    void commands
      .localProjectSnapshot(project.id)
      .then((next) => {
        if (!live) return;
        if (next.revision >= latestProject.current.revision) {
          setProject(next);
          upsertProject(next);
        }
        setRefreshFailed(false);
      })
      .catch(() => {
        if (live) setRefreshFailed(true);
      });
    return () => {
      live = false;
    };
  }, [project.id, refresh, upsertProject]);
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
  function choose() {
    capture();
    setResults(false);
    workspace(project.id).section = "chapters";
    void navigate({
      to: ".",
      search: (previous) => ({
        ...previous,
        section: "chapters",
      }),
      replace: true,
    });
  }
  useEffect(() => {
    setResults(section === "results");
    if (section === "characters") setCharactersRequest((n) => n + 1);
  }, [section]);
  function changed(next: LocalProjectSnapshot_Serialize) {
    setProject(next);
    upsertProject(next);
    onChange?.(next);
  }
  return (
    <SidebarProvider
      ref={root}
      data-slot="project-workspace"
      className="bg-card h-full min-h-0 flex-1 overflow-hidden"
      style={{ "--sidebar-width": "4rem" } as CSSProperties}
    >
      <AppSidebar
        projectId={project.id}
        section={results ? "results" : "chapters"}
        onSectionChange={(next) => {
          if (next === "chapters") choose();
          else if (next === "characters") {
            if (!project.chapters.length) return;
            choose();
            setCharactersRequest((n) => n + 1);
          } else {
            capture();
            setResults(true);
            workspace(project.id).section = "results";
            void navigate({
              to: ".",
              search: (previous) => ({ ...previous, section: "results" }),
              replace: true,
            });
          }
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {refreshFailed && (
          <div
            role="alert"
            className="text-destructive flex shrink-0 items-center gap-2 border-b px-3 py-1 text-xs"
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
          <AppState
            icon={HeadphonesIcon}
            title={t`音频制作尚未接入`}
            description={t`当前可检查分章和人物归属。声音绑定、音频生成与导出将在后续提供。`}
            actions={
              <Button variant="outline" onClick={() => choose()}>
                <Trans>返回章节制作</Trans>
              </Button>
            }
          />
        )}
        <div
          className={results ? "hidden" : "flex min-h-0 flex-1 flex-col"}
          inert={results}
        >
          <WorkspaceModeContext.Provider
            value={{ active: !results, location, charactersRequest }}
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
