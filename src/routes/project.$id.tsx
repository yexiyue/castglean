import { Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppState } from "@/components/app-state";
import { PageShell } from "@/components/page-shell";
import { ProjectWorkspace } from "@/components/projects/project-workspace";
import { buttonVariants } from "@/components/ui/button";
import { commands, type LocalProjectSnapshot_Serialize } from "@/lib/bindings";
import { useDesktopSession } from "@/lib/desktop-session";
import { useLocalProjects } from "@/lib/local-projects";
import { WorkspaceReaderContext } from "@/lib/workspace/reader";
import {
  createSampleProject,
  sampleReader,
} from "@/lib/workspace/sample-reader";

function SampleWorkspace({
  section,
}: {
  section: "chapters" | "characters" | "results";
}) {
  const [project] = useState(createSampleProject);
  return (
    <WorkspaceReaderContext.Provider value={sampleReader}>
      <ProjectWorkspace project={project} section={section} />
    </WorkspaceReaderContext.Provider>
  );
}

function ProjectPage() {
  const { id } = Route.useParams();
  const { t } = useLingui();
  const { section = "chapters" } = Route.useSearch();
  const { workspace } = useDesktopSession();
  useEffect(() => {
    workspace(id).section = section;
  }, [workspace, id, section]);
  const { upsertProject } = useLocalProjects();
  const [loaded, setLoaded] = useState<LocalProjectSnapshot_Serialize | null>(
    null,
  );
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const project = loaded?.id === id ? loaded : undefined;
  useEffect(() => {
    if (id === "sample") return;
    let active = true;
    setState("loading");
    void commands
      .localProjectSnapshot(id)
      .then((next) => {
        if (!active) return;
        setLoaded(next);
        upsertProject(next);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("failed");
      });
    return () => {
      active = false;
    };
  }, [id, upsertProject]);
  if (id === "sample") return <SampleWorkspace section={section} />;
  if (project?.sources.length)
    return (
      <ProjectWorkspace key={project.id} project={project} section={section} />
    );
  return (
    <PageShell
      active="projects"
      title={t({
        comment: "预览工程无法恢复时的页面标题",
        message: "未找到工程",
      })}
      description={
        state === "loading" ? t`正在读取本地工程…` : t`请返回本地工程列表重试。`
      }
    >
      <AppState
        kind="unavailable"
        title={
          state === "loading"
            ? t`正在读取本地工程…`
            : state === "failed"
              ? t`无法读取本地工程`
              : t`工程尚未导入原文`
        }
        description={<Trans>工程保存在本机。读取失败时原记录仍会保留。</Trans>}
        className="m-8 w-auto"
        actions={
          <>
            <Link to="/" className={buttonVariants()}>
              <Trans>返回工程列表</Trans>
            </Link>
            <Link
              to="/new"
              search={{ draft: project?.id }}
              className={buttonVariants({ variant: "ghost" })}
            >
              <Trans comment="重新开始新建工程与章节导入">重新导入</Trans>
            </Link>
          </>
        }
      />
    </PageShell>
  );
}

export const Route = createFileRoute("/project/$id")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    section?: "chapters" | "characters" | "results";
  } => ({
    section:
      search.section === "characters" || search.section === "results"
        ? search.section
        : "chapters",
  }),
  component: ProjectPage,
});
