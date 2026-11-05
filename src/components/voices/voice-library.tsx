import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { isTauri } from "@tauri-apps/api/core";
import { PlusIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { AppState } from "@/components/app-state";
import { ModelSelect } from "@/components/models/model-select";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useModelResources } from "@/hooks/use-model-resources";
import { useVoiceStudio } from "@/hooks/use-voice-studio";
import { useVoiceTransfers } from "@/hooks/use-voice-transfers";
import { modelId } from "@/lib/models";
import { AuditionPanel } from "./audition-panel";
import { ImportVoiceDialog } from "./import-voice-dialog";
import { MyVoiceLibrary } from "./my-voice-library";
import { StudioJobs } from "./studio-jobs";
import { VoiceDetailContent, VoiceProperties } from "./voice-detail-content";
import { VoiceLibraryRows } from "./voice-library-rows";
import { VoiceTransferTasks } from "./voice-transfer-tasks";

export function VoiceLibrary() {
  const { t } = useLingui();
  const { library = "preset", model = "all" } = useSearch({ from: "/voices/" });
  const navigate = useNavigate({ from: "/voices/" });
  const { entries } = useModelResources();
  const transfers = useVoiceTransfers();
  const studio = useVoiceStudio();
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const presets = entries
    .filter((m) => model === "all" || modelId(m) === model)
    .flatMap((m) =>
      m.voice_catalog.map((voice) => ({
        ...voice,
        key: JSON.stringify([m.backend, m.model, voice.id]),
        model: m,
      })),
    );
  const voice = presets.find((item) => item.key === selected);
  return (
    <PageShell
      active="voices"
      title={t({ comment: "共享音色资产管理页面", message: "音色中心" })}
      description={t({ message: "设计、试听并管理可跨工程复用的声音。" })}
      actions={
        <>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <UploadIcon data-icon="inline-start" />
            <Trans comment="打开真实批量导入音色包对话框">导入音色包</Trans>
          </Button>
          <Button nativeButton={false} render={<Link to="/voices/new" />}>
            <PlusIcon data-icon="inline-start" />
            <Trans comment="打开音色创建工作台">创建音色</Trans>
          </Button>
        </>
      }
    >
      <div
        className="mx-auto flex max-w-6xl flex-col gap-6 p-6"
        style={{ paddingBottom: "max(2rem, var(--voice-player-inset, 0px))" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
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
          {library === "preset" && (
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
          )}
        </div>
        <VoiceTransferTasks
          transfers={transfers}
          onPreview={() => setImportOpen(true)}
        />
        {library === "mine" ? (
          <MyVoiceLibrary
            transfers={transfers}
            onImport={() => setImportOpen(true)}
          />
        ) : (
          <>
            <VoiceLibraryRows
              preset
              items={presets.map((item) => ({
                id: item.key,
                name: item.name,
                source: item.model.name,
              }))}
              onOpen={setSelected}
            />
            {!presets.length && (
              <AppState
                kind={!isTauri() ? "unavailable" : "empty"}
                title={
                  !isTauri() ? (
                    <Trans>在桌面应用中试听声音</Trans>
                  ) : (
                    <Trans>没有可用的预置音色</Trans>
                  )
                }
                description={
                  !isTauri() ? (
                    <Trans>预置音色由本机模型提供，浏览器预览无法读取。</Trans>
                  ) : (
                    <Trans>在模型中心查看支持预置声音的模型。</Trans>
                  )
                }
                className="border-border min-h-0 items-start rounded-none border-b px-0 py-6 text-left [&_[data-slot=empty-content]]:items-start [&_[data-slot=empty-content]>div]:justify-start [&_[data-slot=empty-header]]:max-w-xl [&_[data-slot=empty-header]]:items-start"
                actions={
                  <Button nativeButton={false} render={<Link to="/models" />}>
                    <Trans comment="进入模型资源目录">模型中心</Trans>
                  </Button>
                }
              />
            )}
          </>
        )}
      </div>
      <ImportVoiceDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        transfers={transfers}
      />
      <Sheet
        modal={false}
        disablePointerDismissal
        open={!!voice}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent
          showOverlay={false}
          className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
          style={{ bottom: "var(--voice-player-inset, 0px)", height: "auto" }}
        >
          <SheetHeader>
            <SheetTitle>{voice?.name}</SheetTitle>
            <SheetDescription>{voice?.model.name}</SheetDescription>
          </SheetHeader>
          {voice && (
            <VoiceDetailContent
              properties={
                <VoiceProperties
                  rows={[
                    {
                      id: "model",
                      label: (
                        <Trans comment="预置音色所属的语音模型">所属模型</Trans>
                      ),
                      value: voice.model.name,
                    },
                    {
                      id: "type",
                      label: (
                        <Trans comment="区分模型预置声音与独立库资产">
                          音色类型
                        </Trans>
                      ),
                      value: (
                        <Trans comment="模型附带的声音，不能在音色库中重命名或删除">
                          模型预置音色
                        </Trans>
                      ),
                    },
                  ]}
                />
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
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
