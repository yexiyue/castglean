import { Trans } from "@lingui/react/macro";
import type { ModelEntry } from "@/lib/bindings";
import { useDesktopSession } from "@/lib/desktop-session";
import { ModelProperties } from "./model-properties";
import {
  ModelFailureNotice,
  ResourceProgressPanel,
} from "./model-resource-feedback";

const examples: ModelEntry[] = [
  {
    backend: "kokoro",
    model: "kokoro-82m",
    name: "Kokoro",
    compiled_devices: ["Cpu", "Metal"],
    available_devices: ["Cpu", "Metal"],
    voice_catalog: [],
    capabilities: { preset: true, reference_cloning: false, style: false },
    voices: 100,
    resource: "Ready",
    unavailable_reason: null,
  },
  {
    backend: "qwen3-tts",
    model: "base",
    name: "Qwen3-TTS",
    compiled_devices: ["Cpu", "Metal"],
    available_devices: ["Cpu"],
    voice_catalog: [],
    capabilities: { preset: false, reference_cloning: true, style: true },
    voices: 0,
    resource: { Missing: { missing_bytes: null } },
    unavailable_reason: null,
  },
];

export function ModelPropertiesPreview() {
  const { openSettings } = useDesktopSession();
  return (
    <section id="model-properties" className="scroll-mt-6 space-y-5">
      <div className="space-y-2">
        <h2 className="text-base font-semibold">
          <Trans>模型详情示例</Trans>
        </h2>
        <p className="text-muted-foreground text-sm">
          <Trans>以下为布局示例，不代表本机模型状态。</Trans>
        </p>
      </div>
      <div className="grid max-w-3xl items-start gap-6 sm:grid-cols-2">
        {examples.map((entry) => (
          <div
            key={entry.backend}
            className="border-border bg-card rounded-lg border"
          >
            <div className="border-border border-b px-5 py-4">
              <h3 className="text-sm font-semibold">{entry.name}</h3>
            </div>
            <div className="p-5">
              <ModelProperties entry={entry} />
            </div>
          </div>
        ))}
      </div>
      <section
        id="model-download-states"
        className="border-border scroll-mt-6 space-y-5 border-t pt-6"
      >
        <h2 className="text-base font-semibold">
          <Trans>下载与失败提示示例</Trans>
        </h2>
        <p className="text-muted-foreground text-sm">
          <Trans>以下为布局示例，不代表本机模型状态。</Trans>
        </p>
        <div className="grid max-w-4xl items-start gap-6 md:grid-cols-2">
          {[
            {
              Downloading: {
                downloaded_bytes: 640_000_000,
                total_bytes: 1_000_000_000,
                bytes_per_second: 8_000_000,
                remaining_seconds: 45,
                stalled: false,
                current_file: "model-00001.safetensors",
              },
            },
            {
              Paused: {
                downloaded_bytes: 640_000_000,
                total_bytes: 1_000_000_000,
                current_file: "model-00001.safetensors",
              },
            },
            {
              Downloading: {
                downloaded_bytes: 640_000_000,
                total_bytes: 1_000_000_000,
                bytes_per_second: 8_000_000,
                remaining_seconds: 45,
                stalled: true,
                current_file: "model-00001.safetensors",
              },
            },
            {
              Downloading: {
                downloaded_bytes: 24_000_000,
                total_bytes: null,
                bytes_per_second: null,
                remaining_seconds: null,
                stalled: false,
                current_file: "model.safetensors",
              },
            },
          ].map((resource) => (
            <div
              key={JSON.stringify(resource)}
              className="bg-card border-border rounded-lg border p-5"
            >
              <ResourceProgressPanel resource={resource} />
            </div>
          ))}
          {(["Network", "Auth", "Disk", "Integrity"] as const).map(
            (failure) => (
              <ModelFailureNotice
                key={failure}
                failure={failure}
                onOpenSettings={() => openSettings("storage")}
              />
            ),
          )}
        </div>
      </section>
    </section>
  );
}
