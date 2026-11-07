import { Trans, useLingui } from "@lingui/react/macro";
import { AudioWaveformIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { AppState } from "@/components/app-state";
import type { ListView } from "@/components/list-view-toggle";
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
import { failureKind, formatBytes } from "@/lib/models";

function EngineProperties({ engine }: { engine: DesignEngineEntry }) {
  return (
    <details className="text-sm">
      <summary className="text-muted-foreground cursor-pointer text-xs">
        <Trans comment="展开音色设计引擎的设备与输入限制">模型属性</Trans>
      </summary>
      <dl className="mt-3 grid grid-cols-[8rem_minmax(0,1fr)] gap-3">
        <dt className="text-muted-foreground">
          <Trans>待下载体积</Trans>
        </dt>
        <dd>{formatBytes(engine.missing_bytes)}</dd>
        <dt className="text-muted-foreground">
          <Trans>试听文本上限</Trans>
        </dt>
        <dd>{engine.text_max_chars}</dd>
        <dt className="text-muted-foreground">
          <Trans>声音描述上限（字节）</Trans>
        </dt>
        <dd>{engine.description_max_bytes}</dd>
        <dt className="text-muted-foreground">
          <Trans>声音描述上限（字符）</Trans>
        </dt>
        <dd>{engine.description_max_chars ?? "—"}</dd>
      </dl>
    </details>
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
  const [selected, setSelected] = useState<{
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
  const prepareButton = (engine: DesignEngineEntry, preparation: unknown) =>
    !engine.ready && (
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground hover:text-foreground"
        disabled={!engine.devices.length || studio.pending || !!preparation}
        onClick={() =>
          void studio.run(async () =>
            setSelected({
              engine,
              storage: await commands.getStorageStatus(),
            }),
          )
        }
      >
        <Trans comment="查看设计权重下载确认">准备资源</Trans>
        <ChevronRightIcon data-icon="inline-end" />
      </Button>
    );
  return (
    <section
      className="flex flex-col gap-4"
      aria-label={t({
        comment: "独立于朗读模型的资源目录",
        message: "音色设计引擎",
      })}
    >
      {view === "cards" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4">
          {engines.map((engine) => {
            const preparation = preparationOf(engine);
            const resource = preparation?.resource ?? engine.resource;
            const failure = failureKind(resource);
            return (
              <div
                key={engine.id}
                className="border-border bg-card hover:border-ring/50 flex min-w-0 flex-col gap-3 rounded-lg border p-4 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <AudioWaveformIcon className="text-muted-foreground mt-0.5 size-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{engine.name}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {engine.devices.join(" · ") ||
                        t({ message: "本机没有可用设备" })}
                    </p>
                  </div>
                  <ResourceStateBadge resource={resource} />
                </div>
                <EngineProperties engine={engine} />
                <ResourceProgressPanel resource={resource} />
                {failure && <ModelFailureNotice failure={failure} />}
                <div className="mt-auto flex justify-end pt-1">
                  {prepareButton(engine, preparation)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="@container min-w-0">
          <div
            aria-hidden="true"
            className="text-muted-foreground hidden gap-4 border-b px-3 py-2 text-xs @min-[700px]:grid @min-[700px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_7.5rem_6rem]"
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
              const preparation = preparationOf(engine);
              const resource = preparation?.resource ?? engine.resource;
              const failure = failureKind(resource);
              return (
                <li
                  key={engine.id}
                  className="border-border hover:bg-accent/40 border-b last:border-b-0"
                >
                  <div className="grid items-center gap-x-4 gap-y-2 p-3 @min-[700px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_7.5rem_6rem]">
                    <div className="flex min-w-0 items-center gap-3">
                      <AudioWaveformIcon className="text-muted-foreground size-4 shrink-0" />
                      <span className="truncate text-sm font-medium">
                        {engine.name}
                      </span>
                    </div>
                    <span className="text-muted-foreground col-span-2 min-w-0 truncate text-xs @min-[700px]:col-span-1">
                      {engine.devices.join(" · ") ||
                        t({ message: "本机没有可用设备" })}
                    </span>
                    <div>
                      <ResourceStateBadge resource={resource} />
                    </div>
                    <div className="justify-self-end">
                      {prepareButton(engine, preparation)}
                    </div>
                  </div>
                  <div className="space-y-3 px-3 pb-4">
                    <ResourceProgressPanel resource={resource} />
                    {failure && <ModelFailureNotice failure={failure} />}
                    <EngineProperties engine={engine} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {!engines.length && (
        <AppState kind="search" title={<Trans>没有匹配的模型</Trans>} />
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Trans>准备音色设计资源</Trans>
            </DialogTitle>
            <DialogDescription>{selected?.engine.name}</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-2 text-sm">
              <p>
                <Trans>
                  待下载：{formatBytes(selected.engine.missing_bytes)}
                </Trans>
              </p>
              <p className="break-all">{selected.storage.cache_dir}</p>
              <p>
                <Trans>
                  可用空间：{formatBytes(selected.storage.available_bytes)}
                </Trans>
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={
                !selected ||
                studio.pending ||
                (selected.storage.available_bytes != null &&
                  selected.storage.available_bytes <
                    (selected.engine.missing_bytes ?? 0))
              }
              onClick={() => {
                if (selected) {
                  void studio.start({
                    kind: "prepare_design",
                    engine: selected.engine.id,
                  });
                  setSelected(null);
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
