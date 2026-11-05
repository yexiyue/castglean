import { Trans } from "@lingui/react/macro";
import type { StudioJob } from "@/lib/bindings";
import { StudioJobFeedback } from "./studio-job-feedback";

const base: StudioJob = {
  id: 1,
  sequence: 1,
  request: {
    kind: "audition",
    backend: "kokoro",
    model: "Kokoro",
    device: "Cpu",
    voice: { kind: "preset", voice: "example" },
    text: "夜潮退去，渡口的灯还亮着。",
    style: null,
  },
  state: "Queued",
  stage: "queued",
  resource: null,
  error: null,
  audio: null,
  candidate: null,
};

const examples: StudioJob[] = [
  base,
  { ...base, id: 2, state: "Running", stage: "loading" },
  { ...base, id: 3, state: "Running", stage: "generating" },
  { ...base, id: 4, state: "Cancelling", stage: "generating" },
  {
    ...base,
    id: 5,
    state: "Succeeded",
    stage: "finished",
    audio: "example-only",
  },
  {
    ...base,
    id: 6,
    state: "Failed",
    stage: "finished",
    error: "example failure",
  },
  {
    ...base,
    id: 7,
    request: { kind: "prepare_design", engine: "MOSS" },
    state: "Running",
    stage: "downloading",
    resource: {
      Downloading: {
        downloaded_bytes: 640_000_000,
        total_bytes: 1_000_000_000,
        bytes_per_second: 8_000_000,
        remaining_seconds: 45,
        stalled: false,
        current_file: "model.safetensors",
      },
    },
  },
  {
    ...base,
    id: 8,
    request: { kind: "prepare_design", engine: "MOSS" },
    state: "Failed",
    stage: "finished",
    resource: { Failed: { error: "Auth", missing_bytes: null } },
  },
  {
    ...base,
    id: 9,
    state: "Cancelled",
    stage: "cancelled",
    resource: {
      Downloading: {
        downloaded_bytes: 640_000_000,
        total_bytes: 1_000_000_000,
        bytes_per_second: 8_000_000,
        remaining_seconds: 45,
        stalled: false,
        current_file: "model.safetensors",
      },
    },
  },
];

export function StudioJobsPreview() {
  return (
    <section id="voice-task-states" className="scroll-mt-6 space-y-5">
      <h2 className="text-base font-semibold">
        <Trans>音色任务状态示例</Trans>
      </h2>
      <p className="text-muted-foreground text-sm">
        <Trans>以下为布局示例，按钮不执行任务，也不会生成或播放音频。</Trans>
      </p>
      <div className="grid max-w-4xl items-start gap-5 md:grid-cols-2">
        {examples.map((job) => (
          <StudioJobFeedback key={job.id} job={job} />
        ))}
      </div>
    </section>
  );
}
