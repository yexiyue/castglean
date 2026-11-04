import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import {
  AudioWaveformIcon,
  PlusIcon,
  PlayIcon,
  SearchIcon,
  UploadIcon,
  Undo2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ImportVoiceDialog } from "@/components/voices/import-voice-dialog";
import { VoiceDetailSheet } from "@/components/voices/voice-detail-sheet";
import { useWorkspaceState } from "@/lib/desktop-session";
import { sampleVoices } from "@/lib/sample-voice-bindings";
import { ModelSelect } from "@/components/models/model-select";
import { findPreviewModel, supports } from "@/lib/preview-models";
import { PageShell } from "@/components/page-shell";
import { AppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function VoiceLibrary() {
  const { t } = useLingui();
  const { library = "preset", model = "all" } = useSearch({ from: "/voices/" });
  const navigate = useNavigate({ from: "/voices/" });
  const [importOpen, setImportOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useWorkspaceState<string | null>(
    "voice-library",
    "selectedVoice",
    null,
  );
  const searchInput = useRef<HTMLInputElement>(null);
  const [names, setNames] = useWorkspaceState<Record<string, string>>(
    "voice-library",
    "names",
    {},
  );
  const [removed, setRemoved] = useWorkspaceState<string[]>(
    "voice-library",
    "removed",
    [],
  );
  const [removedVoice, setRemovedVoice] = useWorkspaceState<{
    id: string;
    name: string;
  } | null>("voice-library", "lastRemoval", null);
  const voices = sampleVoices
    .filter((v) => !removed.includes(v.id))
    .map((v) => ({ ...v, name: names[v.id] ?? v.name, tone: t(v.tone) }));
  const groups: Record<string, string> = {
    female: t({ comment: "音色分类", message: "女声" }),
    male: t({ comment: "音色分类", message: "男声" }),
    youth: t({ comment: "音色分类", message: "少年声" }),
  };
  const sourceVoices = voices.filter((voice) =>
    library === "preset"
      ? voice.source === "preset"
      : voice.source !== "preset",
  );
  const visible = sourceVoices.filter(
    (v) =>
      (model === "all" || v.modelId === model) &&
      (filter === "all" || v.group === filter) &&
      `${v.name}${v.tone}`.includes(query.trim()),
  );
  const voice = voices.find((v) => v.id === selected);
  const selectedSource = voice?.source;
  useEffect(() => {
    if (!selectedSource) return;
    const target = selectedSource === "preset" ? "preset" : "mine";
    if (library !== target)
      void navigate({
        search: (previous) => ({ ...previous, library: target }),
      });
  }, [selectedSource, library, navigate]);
  return (
    <PageShell
      active="voices"
      title={t({ comment: "独立音色库页面标题", message: "音色中心" })}
      description={t({
        message: "创建、试听与管理声音，在章节制作时绑定给角色。",
      })}
      actions={
        <>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <UploadIcon data-icon="inline-start" />
            <Trans comment="打开导入已有 .voice 音色资源包的对话框">
              导入音色包
            </Trans>
          </Button>
          <Button
            nativeButton={false}
            render={
              <Link
                to="/voices/new"
                search={{ model: model === "all" ? "preview-design" : model }}
              />
            }
          >
            <PlusIcon data-icon="inline-start" />
            <Trans comment="进入文字设计或参考录音创建音色的页面">
              创建音色
            </Trans>
          </Button>
        </>
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            value={library}
            onValueChange={(value) => {
              setSelected(null);
              setFilter("all");
              void navigate({
                search: (previous) => ({
                  ...previous,
                  library: value === "mine" ? "mine" : "preset",
                }),
              });
            }}
          >
            <TabsList variant="line">
              <TabsTrigger value="preset">
                <Trans comment="模型或服务随附的声音，不是工程默认旁白">
                  预置音色
                </Trans>
              </TabsTrigger>
              <TabsTrigger value="mine">
                <Trans comment="用户克隆、设计或导入的声音资产">我的音色</Trans>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <ModelSelect
            allowAll
            value={model}
            onChange={(value) => {
              setSelected(null);
              void navigate({
                search: (previous) => ({ ...previous, model: value }),
              });
            }}
          />
        </div>
        <p className="text-muted-foreground text-sm leading-6">
          {library === "preset" ? (
            <Trans>
              直接使用模型自带的声音，无需克隆。试听和生成前需准备对应模型。
            </Trans>
          ) : (
            <Trans>
              管理参考克隆、文字设计与导入的音色；每个音色仅用于兼容模型。
            </Trans>
          )}
        </p>
        {removedVoice && removed.includes(removedVoice.id) && (
          <div
            role="status"
            className="bg-muted/50 flex flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-2 text-sm"
          >
            <span>
              <Trans comment="仅从界面预览中移除的示例音色名称">
                已从预览中移除「{removedVoice.name}」
              </Trans>
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRemoved((current) =>
                  current.filter((id) => id !== removedVoice.id),
                );
                setRemovedVoice(null);
              }}
            >
              <Undo2Icon data-icon="inline-start" />
              <Trans comment="恢复刚从预览音色列表移除的示例">撤销移除</Trans>
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={filter} onValueChange={(v) => setFilter(String(v))}>
            <TabsList variant="line">
              <TabsTrigger value="all">
                <Trans comment="音色分类筛选，显示所有声音">全部</Trans>
              </TabsTrigger>
              {Object.entries(groups).map(([id, label]) => (
                <TabsTrigger key={id} value={id}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex w-64 items-center gap-2">
            <SearchIcon className="text-muted-foreground size-4 shrink-0" />
            <Input
              ref={searchInput}
              aria-label={t({
                comment: "音色库名称与描述搜索框",
                message: "搜索音色",
              })}
              placeholder={t({
                comment: "音色搜索提示",
                message: "名称或声音特点…",
              })}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((v) => (
            <Card key={v.id} data-voice-id={v.id}>
              <CardHeader>
                <div className="mb-4 flex items-start justify-between">
                  <div className="bg-secondary text-primary flex size-12 items-center justify-center rounded-xl text-lg font-semibold">
                    {Array.from(v.name)[0]}
                  </div>
                  <Badge variant="outline">
                    <Trans comment="未连接真实音色服务的声音卡片">
                      示例音色
                    </Trans>
                  </Badge>
                </div>
                <CardTitle>{v.name}</CardTitle>
                <CardDescription>
                  {groups[v.group]} · {v.tone}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-muted-foreground text-xs">
                  {t(findPreviewModel(v.modelId).name)} ·{" "}
                  {v.source === "preset" ? (
                    <Trans comment="模型或服务随附的声音，不是工程默认旁白">
                      预置音色
                    </Trans>
                  ) : v.source === "reference" ? (
                    <Trans comment="从参考录音创建声音的模型能力">
                      参考克隆
                    </Trans>
                  ) : (
                    <Trans comment="从文字描述创建声音的模型能力">
                      文字设计
                    </Trans>
                  )}
                </p>
                <div
                  aria-hidden="true"
                  className="bg-muted/50 text-muted-foreground flex h-12 items-center justify-center gap-2 rounded-lg"
                >
                  <AudioWaveformIcon className="size-5" />
                  <span className="text-xs">
                    <Trans comment="声音卡片尚无可播放的音频样本">
                      暂无试听样本
                    </Trans>
                  </span>
                </div>
              </CardContent>
              <CardFooter className="justify-between">
                <Button variant="ghost" size="sm" disabled>
                  <PlayIcon data-icon="inline-start" />
                  <Trans comment="试听音色，真实音频暂未接入">试听</Trans>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelected(v.id)}
                >
                  <Trans comment="打开声音资源详情，不绑定角色">查看详情</Trans>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
        {visible.length === 0 ? (
          model !== "all" &&
          library === "preset" &&
          !supports(findPreviewModel(model), "preset") &&
          !query &&
          filter === "all" ? (
            <AppState
              kind="unavailable"
              title={<Trans>此模型没有预置音色</Trans>}
              description={
                <Trans>
                  请选择其他模型浏览预置声音，或为此模型创建专属音色。
                </Trans>
              }
              actions={
                <Button
                  nativeButton={false}
                  render={<Link to="/voices/new" search={{ model }} />}
                >
                  <Trans comment="进入文字设计或参考录音创建音色的页面">
                    创建音色
                  </Trans>
                </Button>
              }
            />
          ) : sourceVoices.length === 0 ? (
            <AppState
              icon={AudioWaveformIcon}
              title={
                library === "mine" ? (
                  <Trans>还没有自己的音色</Trans>
                ) : (
                  <Trans>没有可用的预置音色</Trans>
                )
              }
              description={
                library === "mine" ? (
                  <Trans>创建一个音色，或导入已有的 .voice 音色包。</Trans>
                ) : (
                  <Trans>在模型中心查看支持预置声音的模型。</Trans>
                )
              }
              actions={
                library === "preset" ? (
                  <Button nativeButton={false} render={<Link to="/models" />}>
                    <Trans comment="应用级共享模型资源页面标题">模型中心</Trans>
                  </Button>
                ) : (
                  <>
                    <Button
                      nativeButton={false}
                      render={
                        <Link
                          to="/voices/new"
                          search={{
                            model: model === "all" ? "preview-design" : model,
                          }}
                        />
                      }
                    >
                      <Trans comment="进入文字设计或参考录音创建音色的页面">
                        创建音色
                      </Trans>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setImportOpen(true)}
                    >
                      <Trans comment="打开导入已有 .voice 音色资源包的对话框">
                        导入音色包
                      </Trans>
                    </Button>
                  </>
                )
              }
            />
          ) : (
            <AppState
              kind="search"
              title={<Trans>没有匹配的音色</Trans>}
              description={
                <Trans>换个声音特点搜索，或清除筛选查看全部音色。</Trans>
              }
              actions={
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                    void navigate({
                      search: (previous) => ({ ...previous, model: "all" }),
                    });
                  }}
                >
                  <Trans comment="重置搜索关键词与分类筛选">
                    清除搜索与筛选
                  </Trans>
                </Button>
              }
            />
          )
        ) : null}
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <AudioWaveformIcon className="size-4" />
          <Trans>示例音色仅供界面预览，角色绑定在章节工作台完成。</Trans>
        </p>
      </div>
      <ImportVoiceDialog open={importOpen} onOpenChange={setImportOpen} />
      {voice && (
        <VoiceDetailSheet
          key={voice.id}
          voice={{ ...voice, groupLabel: groups[voice.group] }}
          onClose={() => setSelected(null)}
          onRename={(name) =>
            setNames((current) => ({ ...current, [voice.id]: name }))
          }
          onDelete={() => {
            setRemoved((current) => [...current, voice.id]);
            setRemovedVoice({ id: voice.id, name: voice.name });
            setSelected(null);
            queueMicrotask(() => searchInput.current?.focus());
          }}
        />
      )}
    </PageShell>
  );
}
