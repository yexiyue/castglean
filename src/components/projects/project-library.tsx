import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { AudioWaveformIcon, BookOpenIcon, UsersIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { AppState } from "@/components/app-state";
import { LocalProjectStatus } from "@/components/projects/local-project-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { LocalProjectSnapshot_Serialize } from "@/lib/bindings";
import { useDesktopSession } from "@/lib/desktop-session";

export function ProjectLibrary({
  id,
  project,
  section,
}: {
  id: string;
  project?: LocalProjectSnapshot_Serialize;
  section: "characters" | "results";
}) {
  const isCharacters = section === "characters";
  const { openSettings } = useDesktopSession();
  return (
    <SidebarProvider
      className="bg-background h-full min-h-0 overflow-hidden"
      style={{ "--sidebar-width": "4rem" } as CSSProperties}
    >
      <AppSidebar projectId={id} section={section} />
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="bg-card border-border flex h-(--app-header-height) shrink-0 items-center gap-3 border-b px-5">
          <span className="text-sm font-semibold">
            {project?.title ?? <Trans comment="示例小说工程名称">夜航灯</Trans>}
          </span>
          <span className="text-muted-foreground text-xs">
            {isCharacters ? (
              <Trans comment="工程级人物与选声列表">工程角色</Trans>
            ) : (
              <Trans comment="工程内的采用音频与导出结果">制作结果</Trans>
            )}
          </span>
          <Badge variant="outline" className="ml-auto">
            {project ? (
              <LocalProjectStatus />
            ) : (
              <Trans comment="标记工程为设计预览数据">示例工程</Trans>
            )}
          </Badge>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-4xl">
            {
              <AppState
                icon={isCharacters ? UsersIcon : AudioWaveformIcon}
                title={
                  isCharacters ? (
                    <Trans>还没有工程角色</Trans>
                  ) : (
                    <Trans>还没有制作结果</Trans>
                  )
                }
                description={
                  isCharacters ? (
                    <Trans>
                      导入原文不会自动建立角色。配置文本模型并完成分析后，再检查角色与声音绑定。
                    </Trans>
                  ) : (
                    <Trans>
                      当前没有已采用的音频。先回到章节制作，生成并采用满意的候选。
                    </Trans>
                  )
                }
                className="bg-card border-border rounded-surface border"
                actions={
                  <>
                    <Button
                      variant="outline"
                      nativeButton={false}
                      render={
                        <Link
                          to="/project/$id"
                          params={{ id }}
                          search={{ section: "chapters" }}
                        />
                      }
                    >
                      <BookOpenIcon data-icon="inline-start" />
                      <Trans>返回章节制作</Trans>
                    </Button>
                    {isCharacters && (
                      <Button
                        variant="ghost"
                        onClick={() => openSettings("models")}
                      >
                        <Trans comment="设置类别，仅管理远程端点与凭据，不管理模型资源">
                          服务连接
                        </Trans>
                      </Button>
                    )}
                  </>
                }
              />
            }
          </div>
        </main>
      </section>
    </SidebarProvider>
  );
}
