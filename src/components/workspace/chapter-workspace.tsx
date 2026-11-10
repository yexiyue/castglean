import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useDesktopSession, useWorkspaceState } from "@/lib/desktop-session";
import { cn } from "@/lib/utils";

type WorkspaceView = "characters" | "performance" | "audio";
type SegmentStatus = "confirmed" | "ambiguous" | "unknown" | "generating";

interface Chapter {
  id: string;
  title: string;
  reviewCount: number;
  status: "ready" | "processing" | "pending";
}

interface SourceSegment {
  id: string;
  kind: "narration" | "speech" | "thought";
  speaker?: string;
  status: SegmentStatus;
  text: string;
  evidence: string;
}

const chapters: Chapter[] = [
  {
    id: "chapter-001",
    title: "第一章 夜航灯",
    reviewCount: 3,
    status: "processing",
  },
  {
    id: "chapter-002",
    title: "第二章 旧渡口",
    reviewCount: 0,
    status: "ready",
  },
  {
    id: "chapter-003",
    title: "第三章 潮汐表",
    reviewCount: 5,
    status: "pending",
  },
  {
    id: "chapter-004",
    title: "第四章 修补记录",
    reviewCount: 1,
    status: "pending",
  },
];

const segments: SourceSegment[] = [
  {
    id: "seg-001",
    kind: "narration",
    status: "confirmed",
    text: "夜潮退去后，渡口的石阶露出一线湿亮的青色。灯房里的旧钟走了三下，声音像被水浸过，缓慢而钝。",
    evidence: "第 1–2 行",
  },
  {
    id: "seg-002",
    kind: "speech",
    speaker: "张掌柜",
    status: "confirmed",
    text: "“船不等人，灯也不能灭。你把那卷绳收好，明早还要用。”",
    evidence: "第 3 行",
  },
  {
    id: "seg-003",
    kind: "speech",
    status: "ambiguous",
    text: "“他从来不说这些事。你去问守灯人，也许还能找到半页记录。”",
    evidence: "第 5 行",
  },
  {
    id: "seg-004",
    kind: "thought",
    status: "unknown",
    text: "这句话不像提醒，更像一次托付。可托付的人究竟是谁，她仍不能确定。",
    evidence: "第 6 行",
  },
  {
    id: "seg-005",
    kind: "narration",
    status: "generating",
    text: "风从航道尽头吹来，纸页在灯下轻轻掀动，一行旧字正好停在证据卡的边缘。",
    evidence: "第 8–9 行",
  },
];

function StatusBadge({ status }: { status: SegmentStatus }) {
  if (status === "confirmed") {
    return (
      <Badge variant="success">
        <Trans comment="Status showing a segment has been confirmed">
          已确认
        </Trans>
      </Badge>
    );
  }
  if (status === "ambiguous") {
    return (
      <Badge variant="warning">
        <Trans comment="Status showing a segment has multiple speaker candidates">
          归属歧义
        </Trans>
      </Badge>
    );
  }
  if (status === "unknown") {
    return (
      <Badge variant="outline" className="text-muted-foreground border-border">
        <Trans comment="Status showing the speaker is unknown">未知归属</Trans>
      </Badge>
    );
  }
  return (
    <Badge variant="info">
      <Trans comment="Status showing an audio candidate is generating">
        生成中
      </Trans>
    </Badge>
  );
}

function ChapterStatus({ status }: { status: Chapter["status"] }) {
  if (status === "ready") {
    return (
      <Badge variant="success">
        <Trans comment="Chapter status meaning audio is ready">可试听</Trans>
      </Badge>
    );
  }
  if (status === "processing") {
    return (
      <Badge variant="info">
        <Trans comment="Chapter status meaning a task is running">制作中</Trans>
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground border-border">
      <Trans comment="Chapter status meaning the chapter is waiting">
        待处理
      </Trans>
    </Badge>
  );
}

function SourceCanvas({
  projectId,
  activeView,
  selectedSegmentId,
  onSelectSegment,
}: {
  projectId: string;
  activeView: WorkspaceView;
  selectedSegmentId: string;
  onSelectSegment: (segmentId: string) => void;
}) {
  const { workspace } = useDesktopSession();
  const source = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (source.current)
      source.current.scrollTop = Number(workspace(projectId).sourceScroll ?? 0);
  }, [projectId, workspace]);
  return (
    <section className="bg-background flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-border flex h-12 shrink-0 items-center justify-between gap-3 border-b px-5">
        <h2 className="text-muted-foreground text-xs font-medium">
          <Trans comment="正文阅读区标题，章节名称已在顶部工具栏显示">
            正文
          </Trans>
        </h2>
        <span className="text-muted-foreground text-xs">
          <Trans comment="Metadata showing three items need review">
            3 项待检查
          </Trans>
        </span>
      </div>

      <div
        ref={source}
        onScroll={(event) => {
          workspace(projectId).sourceScroll = event.currentTarget.scrollTop;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-1">
          {segments.map((segment) => {
            const selected = segment.id === selectedSegmentId;
            return (
              <button
                key={segment.id}
                type="button"
                aria-current={selected}
                onClick={() => onSelectSegment(segment.id)}
                className={cn(
                  "border-l-2 px-5 py-2.5 text-left transition-colors",
                  selected
                    ? "border-primary bg-accent/50 rounded-r-lg font-medium"
                    : "hover:bg-card/70 rounded-r-lg border-transparent",
                )}
              >
                {(activeView === "characters" &&
                  (segment.speaker ||
                    segment.status === "ambiguous" ||
                    segment.status === "unknown")) ||
                (activeView === "audio" && segment.status === "generating") ? (
                  <span className="mb-1 flex flex-wrap items-center gap-2">
                    {segment.speaker ? (
                      <span className="text-muted-foreground text-xs font-medium">
                        {segment.speaker}
                      </span>
                    ) : null}
                    {activeView === "characters" &&
                    (segment.status === "ambiguous" ||
                      segment.status === "unknown") ? (
                      <StatusBadge status={segment.status} />
                    ) : null}
                    {activeView === "audio" &&
                    segment.status === "generating" ? (
                      <StatusBadge status={segment.status} />
                    ) : null}
                  </span>
                ) : null}

                <span
                  className={cn(
                    "block text-[15px] leading-8",
                    segment.kind === "speech" &&
                      "decoration-primary/50 underline-offset-8 hover:underline",
                    segment.kind === "thought" && "text-muted-foreground",
                  )}
                >
                  {segment.text}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CharacterPanel({ segment }: { segment: SourceSegment }) {
  return (
    <Card className="m-4" size="sm">
      <CardHeader>
        <CardTitle>
          <Trans comment="Right panel heading for speaker attribution">
            归属检查
          </Trans>
        </CardTitle>
        <CardDescription>
          <Trans comment="当前选中片段的原文定位，显示行号而非技术编号">
            原文依据：{segment.evidence}
          </Trans>
        </CardDescription>
        <CardAction>
          {segment.status === "confirmed" ? (
            <StatusBadge status="confirmed" />
          ) : (
            <Badge variant="outline">
              <Trans comment="Human review state meaning not reviewed yet">
                未检查
              </Trans>
            </Badge>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            <Trans comment="Label for speaker candidates">归属候选</Trans>
          </span>
          <span className="text-muted-foreground text-xs">
            <Trans comment="Field label for the model suggestion source">
              模型建议
            </Trans>
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm">
            <Trans comment="Candidate speaker name in the sample chapter">
              张掌柜
            </Trans>
          </Button>
          <Button size="sm" variant="outline">
            <Trans comment="Candidate meaning the speaker is unknown">
              未知
            </Trans>
          </Button>
        </div>
      </CardContent>
      <CardFooter className="gap-2">
        <Button size="sm">
          <Trans comment="Button to confirm the current attribution">
            确认归属
          </Trans>
        </Button>
        <Button size="sm" variant="ghost">
          <Trans comment="Button to keep the speaker explicitly unknown">
            保留未知
          </Trans>
        </Button>
      </CardFooter>
    </Card>
  );
}

function PerformancePanel() {
  return (
    <Card className="m-4">
      <CardHeader>
        <CardTitle>
          <Trans comment="Right panel heading for narration planning">
            朗读意图
          </Trans>
        </CardTitle>
        <CardDescription>
          <Trans comment="Description explaining scene and paragraph-level narration planning">
            场景走向与段落读法分开；人工覆盖优先于模型建议。
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs font-medium">
            <Trans comment="Label for the scene progression">场景走向</Trans>
          </span>
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="secondary">
              <Trans comment="First scene direction in the sample chapter">
                平静
              </Trans>
            </Badge>
            <span className="bg-border h-px flex-1" />
            <Badge variant="secondary">
              <Trans comment="Second scene direction in the sample chapter">
                加快
              </Trans>
            </Badge>
            <span className="bg-border h-px flex-1" />
            <Badge variant="secondary">
              <Trans comment="Final scene direction in the sample chapter">
                收束
              </Trans>
            </Badge>
          </div>
        </div>
        <Textarea
          aria-label={t({
            comment: "Textarea label for the paragraph narration instruction",
            message: "段落读法",
          })}
          defaultValue="前两句克制、稍慢；引号内保持对话的自然节奏；末句留半拍。"
        />
      </CardContent>
      <CardFooter className="gap-2">
        <Button size="sm" variant="outline">
          <Trans comment="Button to audition the selected narration plan">
            试听当前句
          </Trans>
        </Button>
        <Button size="sm">
          <Trans comment="Button to generate a new audio candidate">
            生成新候选
          </Trans>
        </Button>
      </CardFooter>
    </Card>
  );
}

function ChapterList() {
  const { t } = useLingui();
  return (
    <aside
      data-slot="chapter-list"
      className="border-border bg-sidebar hidden w-60 shrink-0 flex-col border-r md:flex"
    >
      <div className="border-border flex h-16 shrink-0 flex-col justify-center gap-1 border-b px-4">
        <p className="text-muted-foreground text-xs">
          <Trans comment="章节列表顶部的工程标题">当前工程</Trans>
        </p>
        <h2 className="truncate text-sm font-semibold">
          <Trans comment="Sample project title in the chapter sidebar">
            夜航灯
          </Trans>
        </h2>
      </div>
      <div className="p-2 pb-0">
        <SidebarInput
          aria-label={t({
            comment: "Input for searching chapters in the workspace rail",
            message: "搜索章节",
          })}
          placeholder={t({
            comment: "Placeholder for searching chapters",
            message: "章节名 / 编号",
          })}
        />
      </div>
      <SidebarGroup className="min-h-0 flex-1 overflow-y-auto pt-3">
        <SidebarGroupLabel>
          <Trans comment="Label for the chapter list panel">章节列表</Trans>
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu className="gap-1">
            {chapters.map((chapter, index) => (
              <SidebarMenuItem key={chapter.id}>
                <SidebarMenuButton
                  isActive={index === 0}
                  size="lg"
                  className="h-auto items-start py-2"
                >
                  <span className="text-muted-foreground mt-0.5 shrink-0 font-mono text-xs">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {chapter.title}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs font-normal">
                      {chapter.reviewCount > 0 ? (
                        <Trans comment="Review count shown under a chapter title">
                          {chapter.reviewCount} 项待检查
                        </Trans>
                      ) : (
                        <Trans comment="Chapter metadata meaning no items need review">
                          无待检查
                        </Trans>
                      )}
                    </span>
                  </span>
                  <ChapterStatus status={chapter.status} />
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </aside>
  );
}

export function ChapterWorkspace({ projectId }: { projectId: string }) {
  const { t } = useLingui();
  const [contextOpen, setContextOpen] = useWorkspaceState(
    projectId,
    "contextOpen",
    true,
  );
  const [activeView, setActiveView] = useWorkspaceState<WorkspaceView>(
    projectId,
    "view",
    "characters",
  );
  const [selectedSegmentId, setSelectedSegmentId] = useWorkspaceState(
    projectId,
    "selectedSegment",
    "seg-003",
  );
  const selectedSegment =
    segments.find((segment) => segment.id === selectedSegmentId) ?? segments[0];

  return (
    <SidebarProvider
      className="bg-background text-foreground h-full min-h-0 overflow-hidden"
      data-project-id={projectId}
      style={
        {
          "--sidebar-width": "4rem",
          "--sidebar-width-icon": "4rem",
        } as CSSProperties
      }
    >
      <AppSidebar projectId={projectId} />

      <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Tabs
          value={activeView}
          onValueChange={(value) => setActiveView(value as WorkspaceView)}
          className="min-h-0 flex-1 gap-0"
        >
          <header
            data-slot="workspace-toolbar"
            className="border-border bg-card flex h-(--app-header-height) shrink-0 items-center gap-4 border-b px-5"
          >
            <h1 className="sr-only">
              <Trans comment="Sample project title">夜航灯制作工程</Trans>
            </h1>
            <div className="flex w-full min-w-0 items-center gap-3">
              <TabsList
                aria-label={t({
                  comment: "当前章节正文的显示视图切换",
                  message: "章节视图",
                })}
              >
                <TabsTrigger value="characters">
                  <Trans comment="Workspace tab for characters and attribution">
                    角色
                  </Trans>
                </TabsTrigger>
                <TabsTrigger value="performance">
                  <Trans comment="Workspace tab for narration planning">
                    演绎
                  </Trans>
                </TabsTrigger>
                <TabsTrigger value="audio">
                  <Trans comment="Workspace tab for audio candidates">
                    音频
                  </Trans>
                </TabsTrigger>
              </TabsList>
              <Separator
                orientation="vertical"
                className="data-[orientation=vertical]:h-4"
              />
              <Button variant="ghost" size="sm" className="ml-auto" disabled>
                <SlidersHorizontalIcon data-icon="inline-start" />
                <Trans comment="章节工具栏中的朗读配置入口">朗读设置</Trans>
              </Button>
              <Button size="sm">
                <SparklesIcon data-icon="inline-start" />
                <Trans comment="生成当前整章的音频，不表示分析或人工确认">
                  生成本章
                </Trans>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="hidden lg:inline-flex"
                aria-expanded={contextOpen}
                aria-controls="sample-context-panel"
                aria-label={
                  contextOpen
                    ? t({
                        comment: "收起右侧上下文与归属检查区域",
                        message: "收起检查面板",
                      })
                    : t({
                        comment: "展开右侧上下文与归属检查区域",
                        message: "展开检查面板",
                      })
                }
                title={
                  contextOpen
                    ? t({ message: "收起检查面板" })
                    : t({ message: "展开检查面板" })
                }
                onClick={() => setContextOpen((open) => !open)}
              >
                {contextOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
              </Button>
            </div>
          </header>
          <div className="flex min-h-0 flex-1">
            <ChapterList />
            <div className="flex min-h-0 min-w-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <SourceCanvas
                  projectId={projectId}
                  activeView={activeView}
                  selectedSegmentId={selectedSegmentId}
                  onSelectSegment={setSelectedSegmentId}
                />
              </div>

              <aside
                id="sample-context-panel"
                className={cn(
                  "border-border bg-card hidden min-h-0 w-[380px] shrink-0 flex-col border-l lg:flex",
                  !contextOpen && "lg:hidden",
                )}
              >
                <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
                  <span className="text-muted-foreground text-xs font-medium">
                    <Trans comment="Right panel label">上下文</Trans>
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <TabsContent value="characters">
                    <CharacterPanel segment={selectedSegment} />
                  </TabsContent>
                  <TabsContent value="performance">
                    <PerformancePanel />
                  </TabsContent>
                  <TabsContent value="audio">
                    <div className="text-muted-foreground flex flex-col gap-2 p-4 text-sm">
                      <p className="font-medium">
                        <Trans>音频制作尚未接入</Trans>
                      </p>
                      <p className="text-xs leading-5">
                        <Trans>
                          声音绑定可在真实工程的角色中心使用；章节音频生成与候选采用将在后续提供。
                        </Trans>
                      </p>
                    </div>
                  </TabsContent>
                </div>
              </aside>
            </div>
          </div>
        </Tabs>
      </SidebarInset>
    </SidebarProvider>
  );
}
