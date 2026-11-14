import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
import { BoxesIcon, PlusIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { AppState } from "@/components/app-state";
import { BrowserPreviewGuide } from "@/components/browser-preview-guide";
import { DetailHero } from "@/components/detail-hero";
import { Property, PropertyGroup } from "@/components/detail-properties";
import { type ListView, ListViewToggle } from "@/components/list-view-toggle";
import { ModelLogo } from "@/components/models/model-logo";
import { ModelSelect } from "@/components/models/model-select";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchInput } from "@/components/ui/search-input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useModelResources } from "@/hooks/use-model-resources";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import { useVoiceTransfers } from "@/hooks/use-voice-transfers";
import { useWorkspaceState } from "@/lib/desktop-session";
import { modelId } from "@/lib/models";
import { AuditionPanel } from "./audition-panel";
import { ImportVoiceDialog } from "./import-voice-dialog";
import { MyVoiceLibrary } from "./my-voice-library";
import { StudioJobs } from "./studio-jobs";
import { VoiceDetailContent } from "./voice-detail-content";
import { VoiceLibraryRows } from "./voice-library-rows";
import { VoiceTransferTasks } from "./voice-transfer-tasks";

export function VoiceLibrary() {
  const { t } = useLingui();
  const { library = "preset", model = "all" } = useSearch({ from: "/voices/" });
  const navigate = useNavigate({ from: "/voices/" });
  const resources = useModelResources();
  const { entries } = resources;
  const transfers = useVoiceTransfers();
  const studio = useVoiceStudio();
  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useWorkspaceState<ListView>(
    "voices",
    "listView",
    "table",
  );
  const presets = entries
    .filter((m) => model === "all" || modelId(m) === model)
    .flatMap((m) =>
      m.voice_catalog.map((voice) => ({
        ...voice,
        key: JSON.stringify([m.backend, m.model, voice.id]),
        model: m,
      })),
    );
  const visiblePresets = presets.filter((item) =>
    `${item.name} ${item.model.name}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const voice = presets.find((item) => item.key === selected);
  const browser = !isTauri();
  return (
    <PageShell
      active="voices"
      title={t({ comment: "共享音色资产管理页面", message: "音色中心" })}
      description={t({ message: "设计、试听并管理可跨工程复用的声音。" })}
      navigation={
        browser ? undefined : (
          <Tabs
            value={library}
            onValueChange={(value) => {
              setSelected(null);
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
                <Trans comment="当前模型真实附带的声音目录">预置音色</Trans>
              </TabsTrigger>
              <TabsTrigger value="mine">
                <Trans comment="用户已确认保存的模型无关音色">我的音色</Trans>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )
      }
      actions={
        browser ? undefined : (
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <UploadIcon data-icon="inline-start" />
              <Trans comment="打开真实批量导入音色包对话框">导入音色包</Trans>
            </Button>
            <Link to="/voices/new" className={buttonVariants()}>
              <PlusIcon data-icon="inline-start" />
              <Trans comment="打开音色创建工作台">创建音色</Trans>
            </Link>
          </>
        )
      }
    >
      {browser ? (
        <div
          className="mx-auto w-full max-w-6xl px-6 py-12"
          style={{ paddingBottom: "max(3rem, var(--voice-player-inset, 0px))" }}
        >
          <BrowserPreviewGuide
            summary={
              <Trans>
                预置音色、音色包导入与音色创建依赖本机模型和文件，请在桌面应用中使用。
              </Trans>
            }
          />
        </div>
      ) : (
        <div
          className="mx-auto flex max-w-6xl flex-col gap-4 p-5"
          style={{ paddingBottom: "max(2rem, var(--voice-player-inset, 0px))" }}
        >
          {library === "preset" && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SearchInput
                className="w-64 max-w-full"
                aria-label={t`搜索预置音色`}
                placeholder={t`搜索音色或模型…`}
                value={query}
                onValueChange={setQuery}
              />
              <div className="flex flex-wrap items-center gap-3">
                <ModelSelect
                  allowAll
                  disabled={resources.loading || !!resources.error}
                  value={model}
                  onChange={(value) => {
                    setSelected(null);
                    void navigate({
                      search: (previous) => ({ ...previous, model: value }),
                    });
                  }}
                />
                <ListViewToggle value={view} onChange={setView} />
              </div>
            </div>
          )}
          <VoiceTransferTasks
            transfers={transfers}
            onPreview={() => setImportOpen(true)}
          />
          {library === "mine" ? (
            <MyVoiceLibrary
              transfers={transfers}
              view={view}
              viewControl={<ListViewToggle value={view} onChange={setView} />}
              onImport={() => setImportOpen(true)}
            />
          ) : resources.loading ? (
            <AppState kind="loading" title={<Trans>正在读取预置音色…</Trans>} />
          ) : resources.error ? (
            <AppState
              kind="error"
              title={<Trans>预置音色读取失败</Trans>}
              description={<Trans>请重新读取模型资源目录。</Trans>}
              actions={
                <Button
                  variant="outline"
                  onClick={() => void resources.refresh()}
                >
                  <Trans>重试读取</Trans>
                </Button>
              }
            />
          ) : (
            <>
              <VoiceLibraryRows
                preset
                view={view}
                items={visiblePresets.map((item) => ({
                  id: item.key,
                  name: item.name,
                  backend: item.model.backend,
                  detail: item.id,
                  source: item.model.name,
                  sourceDetail: `${item.model.backend}/${item.model.model || "—"}`,
                }))}
                onOpen={setSelected}
              />
              {visiblePresets.length === 0 &&
              (query.trim() || model !== "all") ? (
                <AppState
                  kind="search"
                  compact
                  title={<Trans>没有匹配的音色</Trans>}
                  actions={
                    <Button
                      variant="outline"
                      onClick={() => {
                        setQuery("");
                        void navigate({
                          search: (previous) => ({ ...previous, model: "all" }),
                        });
                      }}
                    >
                      {model === "all" ? (
                        <Trans>清除搜索</Trans>
                      ) : (
                        <Trans>清除筛选</Trans>
                      )}
                    </Button>
                  }
                />
              ) : null}
              {!presets.length && !query.trim() && model === "all" && (
                <AppState
                  kind="empty"
                  align="start"
                  title={<Trans>没有可用的预置音色</Trans>}
                  description={
                    <Trans>在模型中心查看支持预置声音的模型。</Trans>
                  }
                  placement="list"
                  actions={
                    <Link to="/models" className={buttonVariants()}>
                      <Trans comment="进入模型资源目录">模型中心</Trans>
                    </Link>
                  }
                />
              )}
            </>
          )}
        </div>
      )}
      <ImportVoiceDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        transfers={transfers}
      />
      <Dialog
        open={!!voice}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent padding="none" className="sm:max-w-lg">
          {voice && (
            <>
              {/* Hero 卡头：模型标识 + 名称 + 类型徽章，与模型中心详情同构。 */}
              <DetailHero>
                <div className="flex min-w-0 items-center gap-3 pr-8">
                  <ModelLogo backend={voice.model.backend} size="lg" />
                  <div className="min-w-0 flex-1">
                    <DialogTitle>
                      <span className="break-words">{voice.name}</span>
                    </DialogTitle>
                    <DialogDescription>
                      <span className="break-words">{voice.model.name}</span>
                    </DialogDescription>
                  </div>
                  <Badge variant="outline">
                    <Trans comment="模型附带的声音，不能在音色库中重命名或删除">
                      模型预置音色
                    </Trans>
                  </Badge>
                </div>
                <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs tabular-nums">
                  <span>{`${voice.model.backend}/${voice.model.model || "—"}`}</span>
                </div>
              </DetailHero>
              <VoiceDetailContent
                properties={
                  <PropertyGroup
                    title={<Trans comment="预置音色的模型归属分组">归属</Trans>}
                    icon={BoxesIcon}
                  >
                    <Property
                      label={
                        <Trans comment="预置音色所属的语音模型">所属模型</Trans>
                      }
                    >
                      {voice.model.name}
                    </Property>
                    <Property
                      label={
                        <Trans comment="区分模型预置声音与独立库资产">
                          音色类型
                        </Trans>
                      }
                    >
                      <Trans comment="模型附带的声音，不能在音色库中重命名或删除">
                        模型预置音色
                      </Trans>
                    </Property>
                  </PropertyGroup>
                }
                audition={
                  <AuditionPanel
                    key={voice.key}
                    studio={studio}
                    voice={{ kind: "preset", voice: voice.id }}
                    fixedModel={modelId(voice.model)}
                  />
                }
                results={<StudioJobs studio={studio} />}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
