import { Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppState } from "@/components/app-state";
import { PageShell } from "@/components/page-shell";
import { ImportedWorkspace } from "@/components/projects/imported-workspace";
import { ProjectLibrary } from "@/components/projects/project-library";
import { Button } from "@/components/ui/button";
import { ChapterWorkspace } from "@/components/workspace/chapter-workspace";
import { commands, type LocalProjectSnapshot_Serialize } from "@/lib/bindings";
import { useDesktopSession } from "@/lib/desktop-session";
import { useLocalProjects } from "@/lib/local-projects";
import { sampleVoiceBindings } from "@/lib/sample-voice-bindings";

function ProjectPage() {
  const { id } = Route.useParams();
  const { t } = useLingui();
  const { section = "chapters", binding } = Route.useSearch();
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
  if ((project || id === "sample") && section !== "chapters")
    return (
      <ProjectLibrary
        id={id}
        project={project}
        section={section}
        binding={binding}
      />
    );
  if (project?.chapters.length)
    return <ImportedWorkspace key={project.id} project={project} />;
  if (id === "sample") return <ChapterWorkspace projectId={id} />;
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
            <Button nativeButton={false} render={<Link to="/" />}>
              <Trans>返回工程列表</Trans>
            </Button>
            <Button
              variant="ghost"
              nativeButton={false}
              render={<Link to="/new" search={{ draft: project?.id }} />}
            >
              <Trans comment="重新开始新建工程与章节导入">重新导入</Trans>
            </Button>
          </>
        }
      />
    </PageShell>
  );
}

export const Route = createFileRoute("/project/$id")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { section?: "chapters" | "characters" | "results"; binding?: string } => ({
    section:
      search.section === "characters" || search.section === "results"
        ? search.section
        : "chapters",
    binding:
      typeof search.binding === "string" &&
      sampleVoiceBindings.some((binding) => binding.id === search.binding)
        ? search.binding
        : undefined,
  }),
  component: ProjectPage,
});
