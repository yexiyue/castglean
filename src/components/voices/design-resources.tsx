import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
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
import { formatBytes, stateLabel } from "@/lib/models";

export function DesignResources({ studio }: { studio: VoiceStudio }) {
  const { t } = useLingui();
  const [selected, setSelected] = useState<{
    engine: DesignEngineEntry;
    storage: StorageStatus;
  } | null>(null);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">
        <Trans comment="独立于朗读模型的资源目录">音色设计引擎</Trans>
      </h2>
      {studio.engines.map((engine) => (
        <div
          key={engine.id}
          className="border-border flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
        >
          <div>
            <p className="text-sm font-medium">{engine.name}</p>
            <p className="text-muted-foreground text-xs">
              {engine.devices.join(" · ") || t({ message: "本机没有可用设备" })}{" "}
              · {t(stateLabel(engine.resource).label)}
            </p>
          </div>
          {!engine.ready && (
            <Button
              size="sm"
              variant="outline"
              disabled={!engine.devices.length || studio.pending}
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
      ))}
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
