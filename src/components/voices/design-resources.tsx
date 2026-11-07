import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { AppState } from "@/components/app-state";
import type { ListView } from "@/components/list-view-toggle";
import { ModelLogo } from "@/components/models/model-logo";
import {
  ModelFailureNotice,
  ResourceProgressPanel,
} from "@/components/models/model-resource-feedback";
import { ResourceStateBadge } from "@/components/models/resource-state-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import {
  commands,
  type DesignEngineEntry,
  type StorageStatus,
} from "@/lib/bindings";
import { failureKind, formatBytes, variantOf } from "@/lib/models";
import { cn } from "@/lib/utils";

/** 详情面板里的引擎属性：列表不展开、不折叠，信息集中在详情里，列表布局保持稳定。 */
function EngineProperties({ engine }: { engine: DesignEngineEntry }) {
  return (
    <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
      <dt className="text-muted-foreground">
        <Trans>待下载体积</Trans>
      </dt>
      <dd className="tabular-nums">{formatBytes(engine.missing_bytes)}</dd>
      <dt className="text-muted-foreground">
        <Trans>试听文本上限</Trans>
      </dt>
      <dd className="tabular-nums">{engine.text_max_chars}</dd>
      <dt className="text-muted-foreground">
        <Trans>声音描述上限（字节）</Trans>
      </dt>
      <dd className="tabular-nums">{engine.description_max_bytes}</dd>
      <dt className="text-muted-foreground">
        <Trans>声音描述上限（字符）</Trans>
      </dt>
      <dd className="tabular-nums">{engine.description_max_chars ?? "—"}</dd>
    </dl>
  );
}

export function DesignResources({
  studio,
  query = "",
  view = "cards",
}: {
  studio: VoiceStudio;
  query?: string;
  view?: ListView;
}) {
  const { t } = useLingui();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{
    engine: DesignEngineEntry;
    storage: StorageStatus;
  } | null>(null);
  if (!studio.desktop)
    return (
      <AppState
        kind="unavailable"
        title={<Trans>音色设计需要桌面应用</Trans>}
      />
    );
  if (!studio.engines.length) {
    if (studio.loading || studio.pending)
      return (
        <p role="status" className="text-muted-foreground text-sm">
          <Trans>正在读取音色设计引擎…</Trans>
        </p>
      );
    if (studio.error)
      return (
        <AppState
          kind="error"
          title={<Trans>无法读取音色设计引擎</Trans>}
          actions={
            <Button
              variant="outline"
              onClick={() => void studio.run(async () => {})}
            >
              <Trans comment="重新读取设计引擎目录">重试</Trans>
            </Button>
          }
        />
      );
    return (
      <AppState
        title={<Trans>暂无音色设计引擎</Trans>}
        description={<Trans>此版本未提供音色设计模型。</Trans>}
      />
    );
  }
  const engines = studio.engines.filter((engine) =>
    `${engine.name} ${engine.id}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const preparationOf = (engine: DesignEngineEntry) =>
    [...studio.jobs]
      .reverse()
      .find(
        (job) =>
          job.request.kind === "prepare_design" &&
          job.request.engine === engine.id &&
          ["Queued", "Running", "Cancelling"].includes(job.state),
      );
  const selected = engines.find((engine) => engine.id === selectedId);
  return (
    <section
      className="flex min-w-0 flex-col"
      aria-label={t({
        comment: "独立于朗读模型的资源目录",
        message: "音色设计引擎",
      })}
    >
      <div className="min-w-0">
        {view === "cards" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4">
            {engines.map((engine) => {
              const resource =
                preparationOf(engine)?.resource ?? engine.resource;
              return (
                <button
                  key={engine.id}
                  type="button"
                  aria-pressed={selectedId === engine.id}
                  onClick={() =>
                    setSelectedId(selectedId === engine.id ? null : engine.id)
                  }
                  className={cn(
                    "border-border bg-card focus-visible:ring-ring hover:border-ring/50 flex min-w-0 flex-col gap-3 rounded-lg border p-4 text-left transition-colors outline-none focus-visible:ring-2",
                    selectedId === engine.id && "border-ring/60 bg-accent/30",
                  )}
                >
                  <span className="flex items-start gap-3">
                    <ModelLogo backend={engine.id} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {engine.name}
                      </span>
                      <span className="text-muted-foreground mt-1 block truncate text-xs">
                        {engine.devices.join(" · ") ||
                          t({ message: "本机没有可用设备" })}
                      </span>
                    </span>
                    <ResourceStateBadge resource={resource} />
                  </span>
                  {["Downloading", "Preparing", "Paused"].includes(
                    variantOf(resource),
                  ) && <ResourceProgressPanel resource={resource} />}
                  <span className="text-muted-foreground mt-auto flex items-center justify-end gap-1 pt-1 text-xs">
                    <Trans comment="打开设计引擎详情面板">管理引擎</Trans>
                    <ChevronRightIcon className="size-3.5" />
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="@container min-w-0">
            <div
              aria-hidden="true"
              className="text-muted-foreground hidden gap-4 border-b px-3 py-2 text-xs @min-[560px]:grid @min-[560px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_7.5rem_1.5rem]"
            >
              <span>
                <Trans comment="设计引擎列表的名称列">引擎</Trans>
              </span>
              <span>
                <Trans comment="设计引擎可用的计算设备列">设备</Trans>
              </span>
              <span>
                <Trans comment="模型资源状态列">资源状态</Trans>
              </span>
              <span />
            </div>
            <ul className="border-border border-b">
              {engines.map((engine) => {
                const resource =
                  preparationOf(engine)?.resource ?? engine.resource;
                const active = selectedId === engine.id;
                return (
                  <li
                    key={engine.id}
                    className={cn(
                      "border-border border-b last:border-b-0",
                      active ? "bg-accent/30" : "hover:bg-accent/40",
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedId(active ? null : engine.id)}
                      className="focus-visible:ring-ring grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 p-3 text-left outline-none focus-visible:ring-2 @min-[560px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_7.5rem_1.5rem]"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <ModelLogo
                          backend={engine.id}
                          className="size-6 p-0.5"
                        />
                        <span className="truncate text-sm font-medium">
                          {engine.name}
                        </span>
                      </span>
                      <span className="text-muted-foreground col-span-2 row-start-2 min-w-0 truncate text-xs @min-[560px]:col-span-1 @min-[560px]:row-start-auto">
                        {engine.devices.join(" · ") ||
                          t({ message: "本机没有可用设备" })}
                      </span>
                      <span>
                        <ResourceStateBadge resource={resource} />
                      </span>
                      <ChevronRightIcon className="text-muted-foreground col-start-2 row-start-1 size-4 justify-self-end @min-[560px]:col-start-auto @min-[560px]:row-start-auto" />
                    </button>
                    {["Downloading", "Preparing", "Paused"].includes(
                      variantOf(resource),
                    ) && (
                      <div className="px-3 pb-3">
                        <ResourceProgressPanel resource={resource} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {!engines.length && (
          <AppState kind="search" title={<Trans>没有匹配的模型</Trans>} />
        )}
      </div>

      <DesignEngineDetails
        engine={selected}
        studio={studio}
        preparation={selected ? preparationOf(selected) : undefined}
        onClose={() => setSelectedId(null)}
        onPrepare={() =>
          void studio.run(async () => {
            if (!selected) return;
            setConfirming({
              engine: selected,
              storage: await commands.getStorageStatus(),
            });
          })
        }
      />

      <Dialog
        open={!!confirming}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Trans>准备音色设计资源</Trans>
            </DialogTitle>
            <DialogDescription>{confirming?.engine.name}</DialogDescription>
          </DialogHeader>
          {confirming && (
            <div className="space-y-2 text-sm">
              <p>
                <Trans>
                  待下载：{formatBytes(confirming.engine.missing_bytes)}
                </Trans>
              </p>
              <p className="break-all">{confirming.storage.cache_dir}</p>
              <p>
                <Trans>
                  可用空间：{formatBytes(confirming.storage.available_bytes)}
                </Trans>
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={
                !confirming ||
                studio.pending ||
                (confirming.storage.available_bytes != null &&
                  confirming.storage.available_bytes <
                    (confirming.engine.missing_bytes ?? 0))
              }
              onClick={() => {
                if (confirming) {
                  void studio.start({
                    kind: "prepare_design",
                    engine: confirming.engine.id,
                  });
                  setConfirming(null);
                }
              }}
            >
              <Trans comment="确认下载所列设计资源">确认准备</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

const DesignEngineDetails = ({
  engine,
  studio,
  preparation,
  onClose,
  onPrepare,
}: {
  engine: DesignEngineEntry | undefined;
  studio: VoiceStudio;
  preparation: VoiceStudio["jobs"][number] | undefined;
  onClose: () => void;
  onPrepare: () => void;
}) => {
  const { t } = useLingui();
  const resource = preparation?.resource ?? engine?.resource;
  const failure = resource != null ? failureKind(resource) : null;
  return (
    <Dialog open={!!engine} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {engine && resource != null && (
          <>
            <DialogHeader>
              <div className="flex min-w-0 items-center gap-3 pr-8">
                <ModelLogo backend={engine.id} className="size-12" />
                <div className="min-w-0 flex-1">
                  <DialogTitle className="truncate">{engine.name}</DialogTitle>
                  <DialogDescription className="truncate">
                    {engine.devices.join(" · ") ||
                      t({ message: "本机没有可用设备" })}
                  </DialogDescription>
                </div>
                <ResourceStateBadge resource={resource} />
              </div>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <EngineProperties engine={engine} />
              <ResourceProgressPanel resource={resource} />
              {failure && <ModelFailureNotice failure={failure} />}
            </div>
            <div className="flex flex-col gap-2">
              {!engine.ready && (
                <Button
                  disabled={
                    !engine.devices.length || studio.pending || !!preparation
                  }
                  onClick={onPrepare}
                >
                  <Trans comment="查看设计权重下载确认">准备资源</Trans>
                </Button>
              )}
              <p className="text-muted-foreground text-xs leading-5">
                <Trans>准备资源不影响已保存的音色和工程。</Trans>
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
