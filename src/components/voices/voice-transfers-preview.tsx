import { Trans } from "@lingui/react/macro";
import type { VoiceTaskSnapshot } from "@/lib/voices";
import { VoiceTransferFeedback } from "./voice-transfer-feedback";

const base: VoiceTaskSnapshot = {
  id: 1,
  sequence: 1,
  kind: "Inspect",
  state: "Running",
  stage: "Checking",
  completed: 1,
  total: 3,
  bytes: 2097152,
  preview: null,
  items: [],
  error: null,
  filename: null,
};
const examples: VoiceTaskSnapshot[] = [
  base,
  {
    ...base,
    id: 2,
    kind: "Export",
    stage: "Writing",
    completed: 0,
    total: 0,
    bytes: null,
  },
  { ...base, id: 3, kind: "Import", state: "Cancelling", stage: "Committing" },
  {
    ...base,
    id: 4,
    kind: "Export",
    state: "Completed",
    stage: "Completed",
    completed: 3,
    filename: "narrator-voices.voice",
  },
  {
    ...base,
    id: 5,
    kind: "Import",
    state: "Failed",
    stage: "Completed",
    items: [
      {
        entry: 0,
        name: "旁白",
        status: "Imported",
        local_id: "example-1",
        error: null,
      },
      {
        entry: 1,
        name: "角色",
        status: "Failed",
        local_id: null,
        error: { code: "Disk", input_index: 1 },
      },
      {
        entry: 2,
        name: "配角",
        status: "NotAttempted",
        local_id: null,
        error: null,
      },
    ],
  },
  {
    ...base,
    id: 6,
    state: "Failed",
    stage: "Completed",
    error: { code: "InvalidPackage", input_index: 0 },
  },
  {
    ...base,
    id: 7,
    kind: "Export",
    state: "Failed",
    stage: "Completed",
    error: { code: "Io", input_index: null },
  },
  { ...base, id: 8, kind: "Import", state: "Cancelled", stage: "Completed" },
];

export function VoiceTransfersPreview() {
  return (
    <section id="voice-transfer-states" className="scroll-mt-6 space-y-5">
      <h2 className="text-base font-semibold">
        <Trans>音色导入导出状态示例</Trans>
      </h2>
      <p className="text-muted-foreground text-sm">
        <Trans>
          以下为状态示例，不会读写文件或执行导入导出。可展开查看逐项结果。
        </Trans>
      </p>
      <div className="grid max-w-4xl items-start gap-5 md:grid-cols-2">
        {examples.map((task) => (
          <VoiceTransferFeedback key={task.id} task={task} />
        ))}
      </div>
    </section>
  );
}
