import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { PlusIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { AppState } from "@/components/app-state";
import { ModelSelect } from "@/components/models/model-select";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImportVoiceDialog } from "@/components/voices/import-voice-dialog";
import { MyVoiceLibrary } from "@/components/voices/my-voice-library";
import { VoiceDetailSheet } from "@/components/voices/voice-detail-sheet";
import { VoiceTransferTasks } from "@/components/voices/voice-transfer-tasks";
import { useModelResources } from "@/hooks/use-model-resources";
import { useVoiceTransfers } from "@/hooks/use-voice-transfers";
import { findModel, modelId } from "@/lib/models";
import { sampleVoices } from "@/lib/sample-voice-bindings";

export function VoiceLibrary() {
  const { t } = useLingui();
  const { library = "preset", model = "all" } = useSearch({ from: "/voices/" });
  const navigate = useNavigate({ from: "/voices/" });
  const { entries } = useModelResources();
  const transfers = useVoiceTransfers();
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const presets = sampleVoices.filter(
    (voice) =>
      voice.source === "preset" && (model === "all" || voice.modelId === model),
  );
  const voice = presets.find((item) => item.id === selected);
  return (
    <PageShell
      active="voices"
      title={t({ comment: "共享音色资产管理页面", message: "音色中心" })}
      description={t({
        message: "管理可跨工程复用的声音，批量导入或导出音色包。",
      })}
      actions={
        <>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <UploadIcon data-icon="inline-start" />
            <Trans comment="打开真实批量导入音色包对话框">导入音色包</Trans>
          </Button>
          <Button
            nativeButton={false}
            render={
              <Link
                to="/voices/new"
                search={{
                  model:
                    model === "all"
                      ? entries[0]
                        ? modelId(entries[0])
                        : "all"
                      : model,
                }}
              />
            }
          >
            <PlusIcon data-icon="inline-start" />
            <Trans comment="进入尚在设计预览阶段的音色创建页面">创建音色</Trans>
          </Button>
        </>
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-7 sm:px-8">
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
                <Trans comment="模型随附的声音，此页仍是标记明确的预览">
                  预置音色
                </Trans>
              </TabsTrigger>
              <TabsTrigger value="mine">
                <Trans comment="从宿主真实音色库读取的用户资产">我的音色</Trans>
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
                以下是预置声音的界面示例，真实预置目录与试听尚未接入。示例不能导出为音色资产。
              </Trans>
            </p>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {presets.map((item) => (
                <Card key={item.id}>
                  <CardHeader>
                    <Badge variant="outline">
                      <Trans comment="不是可导出的真实声音资源">示例音色</Trans>
                    </Badge>
                    <CardTitle>{item.name}</CardTitle>
                    <CardDescription>
                      {t(item.tone)} ·{" "}
                      {findModel(entries, item.modelId)?.name ?? item.modelId}
                    </CardDescription>
                  </CardHeader>
                  <CardFooter>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelected(item.id)}
                    >
                      <Trans comment="查看预置声音的示例详情">查看详情</Trans>
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
            {presets.length === 0 && (
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
      {voice && (
        <VoiceDetailSheet
          voice={{ ...voice, tone: t(voice.tone) }}
          onClose={() => setSelected(null)}
        />
      )}
    </PageShell>
  );
}
