import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { AppState } from "@/components/app-state";
import {
  ModelFailureNotice,
  ResourceProgressPanel,
} from "@/components/models/model-resource-feedback";
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
import { failureKind, formatBytes, stateLabel } from "@/lib/models";

export function DesignResources({
  studio,
  query = "",
}: {
  studio: VoiceStudio;
  query?: string;
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
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">
        <Trans comment="独立于朗读模型的资源目录">音色设计引擎</Trans>
      </h2>
      <div className="divide-y border-y">
        {engines.map((engine) => {
          const preparation = [...studio.jobs]
            .reverse()
            .find(
              (job) =>
                job.request.kind === "prepare_design" &&
                job.request.engine === engine.id &&
                ["Queued", "Running", "Cancelling"].includes(job.state),
            );
          const resource = preparation?.resource ?? engine.resource;
          const failure = failureKind(resource);
          return (
            <div key={engine.id} className="space-y-3 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{engine.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {engine.devices.join(" · ") ||
                      t({ message: "本机没有可用设备" })}{" "}
                    · {t(stateLabel(resource).label)}
                  </p>
                </div>
                {!engine.ready && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      !engine.devices.length || studio.pending || !!preparation
                    }
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
                  </Button>
                )}
              </div>
              <details className="text-sm">
                <summary className="text-muted-foreground cursor-pointer">
                  <Trans comment="展开音色设计引擎的设备与输入限制">
                    模型属性
                  </Trans>
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
              <ResourceProgressPanel resource={resource} />
              {failure && <ModelFailureNotice failure={failure} />}
            </div>
          );
        })}
      </div>
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
