import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";
import logoUrl from "../../assets/brand/logo.png";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AppState } from "@/components/app-state";
import { Link } from "@tanstack/react-router";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ThemePreview = "light" | "dark";

const themePalettes = [
  {
    id: "light" as const,
    tokens: [
      { name: "background", value: "#F8FAFC", foreground: "#0F172A" },
      { name: "card", value: "#FFFFFF", foreground: "#0F172A" },
      { name: "primary", value: "#2563EB", foreground: "#FFFFFF" },
      { name: "muted", value: "#F1F5F9", foreground: "#64748B" },
      { name: "accent", value: "#E2E8F0", foreground: "#0F172A" },
      { name: "border", value: "#E2E8F0", foreground: "#64748B" },
    ],
  },
  {
    id: "dark" as const,
    tokens: [
      { name: "background", value: "#141210", foreground: "#EDE8E0" },
      { name: "card", value: "#1C1917", foreground: "#EDE8E0" },
      { name: "primary", value: "#E78A3E", foreground: "#201205" },
      { name: "muted", value: "#262220", foreground: "#A69C90" },
      { name: "accent", value: "#2E2823", foreground: "#EDE8E0" },
      { name: "border", value: "#302B26", foreground: "#A69C90" },
    ],
  },
];

function DesignSystemPage() {
  const { t } = useLingui();
  const [theme, setTheme] = useState<ThemePreview>("light");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const voiceItems = [
    {
      label: t({
        comment: "Voice option for a calm narration voice",
        message: "沈静旁白",
      }),
      value: "calm-narration",
    },
    {
      label: t({
        comment: "Voice option for a bright female character voice",
        message: "清亮女声",
      }),
      value: "bright-female",
    },
    {
      label: t({
        comment: "Voice option for a low male character voice",
        message: "低沉男声",
      }),
      value: "low-male",
    },
  ];

  return (
    <main className="bg-background text-foreground min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <header className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-6">
            <img
              src={logoUrl}
              alt={t({
                comment: "Alt text for the CastGlean owl-and-book logo",
                message: "CastGlean 标志",
              })}
              className="size-14 rounded-xl"
            />
            <div className="flex flex-col gap-3">
              <p className="text-muted-foreground text-sm font-medium">
                <Trans comment="Label above the design system page title">
                  设计系统
                </Trans>
              </p>
              <h1 className="text-4xl leading-tight font-semibold tracking-tight md:text-5xl">
                CastGlean · 拾角
              </h1>
              <p className="text-muted-foreground max-w-xl text-sm leading-relaxed">
                <Trans comment="Description of the design direction on the design system page">
                  简洁、精致、可核对的生产工作台。界面保持正文可读，证据与候选始终可追溯。
                </Trans>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">shadcn/ui</Badge>
            <Badge variant="secondary">Base UI</Badge>
            <Badge variant="secondary">Nova</Badge>
          </div>
        </header>

        <Separator />

        <section className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h2 className="font-heading text-2xl">
              <Trans comment="Heading for the color foundation section">
                色彩角色
              </Trans>
            </h2>
            <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
              <Trans comment="Explanation of how brand colors map to interface roles">
                界面用浅灰底、白色卡片和熟悉的蓝色行动色；暗色保持同一层级，不做品牌反色。
              </Trans>
            </p>
          </div>
          <Tabs
            value={theme}
            onValueChange={(value) => setTheme(value as ThemePreview)}
          >
            <TabsList>
              <TabsTrigger value="light">
                <Trans comment="Theme selector for the light preview">
                  亮色
                </Trans>
              </TabsTrigger>
              <TabsTrigger value="dark">
                <Trans comment="Theme selector for the dark preview">
                  暗色
                </Trans>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid gap-5 md:grid-cols-2">
            {themePalettes.map((palette) => (
              <Card
                key={palette.id}
                className={theme === palette.id ? "border-ring/50" : undefined}
              >
                <CardHeader>
                  <CardTitle className="text-base">
                    {palette.id === "light" ? (
                      <Trans comment="Heading for the complete light palette">
                        亮色主题
                      </Trans>
                    ) : (
                      <Trans comment="Heading for the complete dark palette">
                        暗色主题
                      </Trans>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {palette.tokens.map((token) => (
                    <div
                      key={token.name}
                      className="flex h-16 items-center justify-between rounded-lg px-4"
                      style={{
                        backgroundColor: token.value,
                        color: token.foreground,
                      }}
                    >
                      <span className="text-sm font-medium">{token.name}</span>
                      <span className="font-mono text-xs opacity-80">
                        {token.value}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans comment="Heading for the interactive controls section">
                  控件状态
                </Trans>
              </CardTitle>
              <CardDescription>
                <Trans comment="Description for the button, input and select preview">
                  主行动用蓝色，输入和选择器使用常规桌面控件比例与圆角。
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-7">
              <div className="flex flex-wrap gap-3">
                <Button>
                  <Trans comment="Button that starts generating an audio candidate">
                    生成候选
                  </Trans>
                </Button>
                <Button variant="outline">
                  <Trans comment="Button that opens the source evidence for review">
                    查看原文
                  </Trans>
                </Button>
                <Button variant="ghost">
                  <Trans comment="Button that saves a manual correction">
                    保留修正
                  </Trans>
                </Button>
                <Button disabled>
                  <Trans comment="Disabled button shown while a task is running">
                    任务执行中
                  </Trans>
                </Button>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Input
                    aria-label={t({
                      comment: "Input for searching project chapters",
                      message: "搜索章节",
                    })}
                    placeholder={t({
                      comment: "Placeholder for searching project chapters",
                      message: "输入章节名或编号",
                    })}
                  />
                </div>
                <Select items={voiceItems} defaultValue="calm-narration">
                  <SelectTrigger
                    aria-label={t({
                      comment: "Select for choosing the narration voice",
                      message: "选择旁白声音",
                    })}
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {voiceItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <Textarea
                aria-label={t({
                  comment: "Textarea for editing narration instructions",
                  message: "朗读指令",
                })}
                placeholder={t({
                  comment:
                    "Placeholder showing a restrained narration instruction",
                  message: "这一段保持平静，末句稍作停顿。",
                })}
              />

              <div className="flex flex-col gap-2">
                <Progress value={42} />
                <div className="text-muted-foreground flex justify-between text-xs">
                  <span>
                    <Trans comment="Label for audio generation progress">
                      正在合成第 3 段
                    </Trans>
                  </span>
                  <span>42%</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <Trans comment="Heading for the workbench layout preview">
                  工作台结构
                </Trans>
              </CardTitle>
              <CardDescription>
                <Trans comment="Description of the main desktop workbench structure">
                  左侧章节导航，中央不可变正文，右侧上下文检查，底部全局播放器。
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="border-border bg-card grid min-h-72 grid-cols-[0.7fr_2fr_1.3fr] overflow-hidden rounded-xl border">
                <div className="border-border flex flex-col gap-3 border-r p-3">
                  <div className="bg-primary h-2.5 w-10" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-3 w-3/5" />
                  <div className="bg-muted-foreground/50 mt-auto h-2 w-8" />
                </div>
                <div className="flex flex-col justify-between p-5">
                  <div className="text-muted-foreground flex max-w-md flex-col gap-3 text-sm leading-7">
                    <span className="bg-foreground/70 h-2 w-16" />
                    <span>
                      <Trans comment="Mock source text explaining immutable reading behavior">
                        正文保持安静底色，选中范围只创建标注，不修改来源。
                      </Trans>
                    </span>
                    <span className="border-primary text-foreground border-l-2 pl-3">
                      <Trans comment="Mock quoted line that needs attribution review">
                        “这句话的归属候选需要人工确认。”
                      </Trans>
                    </span>
                    <span>
                      <Trans comment="Mock source text describing playback highlighting">
                        播放时高亮只覆盖已验证的片段范围。
                      </Trans>
                    </span>
                  </div>
                  <div className="border-border flex items-center gap-3 border-t pt-3">
                    <span className="bg-primary size-2" />
                    <span className="bg-border h-px flex-1" />
                    <span className="text-muted-foreground font-mono text-xs">
                      12:04 / 31:18
                    </span>
                  </div>
                </div>
                <div className="border-border bg-muted/50 flex flex-col gap-4 border-l p-4">
                  <div className="flex flex-col gap-2">
                    <span className="text-muted-foreground text-xs font-medium">
                      <Trans comment="Panel heading for items needing review">
                        待检查
                      </Trans>
                    </span>
                    <span className="text-muted-foreground text-xs leading-5">
                      <Trans comment="Example review item about an ambiguous speaker">
                        说话人候选：张掌柜 / 未知
                      </Trans>
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-muted-foreground text-xs font-medium">
                      <Trans comment="Panel heading for evidence associated with a segment">
                        原文证据
                      </Trans>
                    </span>
                    <span className="border-primary text-muted-foreground h-8 border-l-2 pl-2 text-xs leading-5">
                      <Trans comment="Example evidence quotation reference">
                        第 14–18 行
                      </Trans>
                    </span>
                  </div>
                  <div className="mt-auto flex gap-2">
                    <Button size="sm">
                      <Trans comment="Button that confirms a speaker attribution">
                        确认归属
                      </Trans>
                    </Button>
                    <Button size="sm" variant="outline">
                      <Trans comment="Button that plays the selected audio segment">
                        试听
                      </Trans>
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Tooltip>
                <TooltipTrigger
                  render={<Button variant="ghost" size="sm" className="px-2" />}
                >
                  ?
                </TooltipTrigger>
                <TooltipContent>
                  <Trans comment="Tooltip explaining that switching views preserves reading and playback position">
                    切换视图时保留章节、选区与播放位置。
                  </Trans>
                </TooltipContent>
              </Tooltip>
            </CardFooter>
          </Card>
        </section>

        <section className="flex flex-col gap-5">
          <h2 className="text-2xl font-semibold tracking-tight">
            <Trans comment="Heading for the three workbench views">
              三个视图
            </Trans>
          </h2>
          <Tabs defaultValue="characters">
            <TabsList>
              <TabsTrigger value="characters">
                <Trans comment="Tab for character and attribution review">
                  角色
                </Trans>
              </TabsTrigger>
              <TabsTrigger value="performance">
                <Trans comment="Tab for narration planning and performance review">
                  演绎
                </Trans>
              </TabsTrigger>
              <TabsTrigger value="audio">
                <Trans comment="Tab for audio candidates and generation status">
                  音频
                </Trans>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="characters">
              <Card>
                <CardContent className="text-muted-foreground flex flex-col gap-2 p-6 text-sm leading-relaxed">
                  <Trans comment="Description of the character view">
                    展示归属候选、证据、角色身份与声音入口；名字、身份和声音不混用。
                  </Trans>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="performance">
              <Card>
                <CardContent className="text-muted-foreground flex flex-col gap-2 p-6 text-sm leading-relaxed">
                  <Trans comment="Description of the performance view">
                    场景走向与段落读法分开，人工覆盖保留，实际执行映射可追溯。
                  </Trans>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="audio">
              <Card>
                <CardContent className="text-muted-foreground flex flex-col gap-2 p-6 text-sm leading-relaxed">
                  <Trans comment="Description of the audio view">
                    候选、配置与采用关系分离；失败不覆盖已满意的音频。
                  </Trans>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </section>
        <section
          id="app-states"
          className="flex min-h-[calc(100svh-6rem)] scroll-mt-8 flex-col gap-5"
        >
          <div>
            <h2 className="text-xl font-semibold">
              <Trans comment="设计系统里的空白与错误反馈组件分组">
                状态反馈
              </Trans>
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              <Trans>
                区分没有内容、搜索无结果、服务未就绪与操作失败，并给出下一步。
              </Trans>
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <AppState
              title={<Trans>还没有制作结果</Trans>}
              description={
                <Trans>
                  当前没有已采用的音频。先回到章节制作，生成并采用满意的候选。
                </Trans>
              }
              className="bg-card border-border border"
              actions={
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={
                    <Link
                      to="/project/$id"
                      params={{ id: "sample" }}
                      search={{ section: "chapters" }}
                    />
                  }
                >
                  <Trans>返回章节制作</Trans>
                </Button>
              }
            />
            <AppState
              kind="search"
              title={<Trans>没有匹配的音色</Trans>}
              description={
                <Trans>换个声音特点搜索，或清除筛选查看全部音色。</Trans>
              }
              className="bg-card border-border border"
              actions={
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link to="/voices" />}
                >
                  <Trans comment="应用级跨小说共享声音资源入口">
                    浏览音色库
                  </Trans>
                </Button>
              }
            />
            <AppState
              kind="unavailable"
              title={<Trans>模型服务尚未接入</Trans>}
              description={
                <Trans>
                  当前不能配置或运行模型。以下是能力预览，不会执行分析或合成任务。
                </Trans>
              }
              className="bg-card border-border border"
              actions={
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={
                    <Link
                      to="/settings/$section"
                      params={{ section: "models" }}
                    />
                  }
                >
                  <Trans comment="设置类别，仅管理远程端点与凭据，不管理模型资源">
                    服务连接
                  </Trans>
                </Button>
              }
            />
            <AppState
              kind="error"
              title={<Trans>页面未能加载</Trans>}
              description={
                <Trans>
                  请重试，或返回工程首页重新打开。已保存的工程文件不会被修改。
                </Trans>
              }
              className="bg-card border-border border"
              actions={
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link to="/" />}
                >
                  <Trans comment="找不到页面时返回应用工程列表">
                    返回工程首页
                  </Trans>
                </Button>
              }
            />
          </div>
        </section>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/design-system")({
  component: DesignSystemPage,
});
