import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { PlusIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { AppState } from "@/components/app-state";
import { ModelSelect } from "@/components/models/model-select";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-7 pb-32 sm:px-8">
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
            <p className="text-muted-foreground text-sm">
              <Trans>
                预置声音属于对应模型，可生成试听；它们不是可导出的参考音色资产。
              </Trans>
            </p>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {presets.map((item) => (
                <Card key={item.key}>
                  <CardHeader>
                    <CardTitle>{item.name}</CardTitle>
                    <CardDescription>{item.model.name}</CardDescription>
                  </CardHeader>
                  <CardFooter>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelected(item.key)}
                    >
                      <Trans comment="展开真实预置声音的合成试听">
                        试听声音
                      </Trans>
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
            {!presets.length && (
              <AppState
                title={<Trans>没有可用的预置音色</Trans>}
                description={<Trans>在模型中心查看支持预置声音的模型。</Trans>}
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
          className="overflow-y-auto"
          style={{ bottom: "var(--voice-player-inset, 0px)", height: "auto" }}
        >
          <SheetHeader>
            <SheetTitle>{voice?.name}</SheetTitle>
            <SheetDescription>{voice?.model.name}</SheetDescription>
          </SheetHeader>
          {voice && (
            <div className="space-y-5 px-6 pb-32">
              <AuditionPanel
                key={voice.key}
                studio={studio}
                voice={{ kind: "preset", voice: voice.id }}
                fixedModel={modelId(voice.model)}
              />
              <StudioJobs studio={studio} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
