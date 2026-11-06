import { createFileRoute } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { OpenProjectButton } from "@/components/projects/project-file-controls";
import { ImportedWorkspace } from "@/components/projects/imported-workspace";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { usePreviewProjects } from "@/lib/preview-projects";
import { ProjectLibrary } from "@/components/projects/project-library";
import { useDesktopSession } from "@/lib/desktop-session";
import { useEffect } from "react";
import { ChapterWorkspace } from "@/components/workspace/chapter-workspace";
import { sampleVoiceBindings } from "@/lib/sample-voice-bindings";
import { AppState } from "@/components/app-state";

function ProjectPage() {
  const { id } = Route.useParams();
  const { t } = useLingui();
  const { section = "chapters", binding } = Route.useSearch();
  const { workspace } = useDesktopSession();
  useEffect(() => {
    workspace(id).section = section;
  }, [workspace, id, section]);
  const { projects } = usePreviewProjects();
  const project = projects.find((project) => project.id === id);
  if ((project || id === "sample") && section !== "chapters")
    return (
      <ProjectLibrary
        id={id}
        project={project}
        section={section}
        binding={binding}
      />
    );
  if (project?.chapters.length) return <ImportedWorkspace key={project.id} project={project} />;
  if (id === "sample") return <ChapterWorkspace projectId={id} />;
  return (
    <PageShell
      active="projects"
      title={t({
        comment: "预览工程无法恢复时的页面标题",
        message: "未找到工程",
      })}
      description={t({
        message: "请重新打开已保存的工程文件，或导入章节新建工程。",
      })}
    >
      <AppState
        kind="unavailable"
        title={<Trans>此工程不在当前会话中</Trans>}
        description={
          <Trans>
            从工程文件恢复章节、顺序和原文。尚未保存的会话无法恢复。
          </Trans>
        }
        className="m-8 w-auto"
        actions={
          <>
            <OpenProjectButton />
            <Button
              variant="ghost"
              nativeButton={false}
              render={<Link to="/new" />}
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
