import type { VoiceTransfers } from "@/hooks/use-voice-transfers";
import {
  VoiceTransferFailure,
  VoiceTransferFeedback,
} from "./voice-transfer-feedback";

export function VoiceTransferTasks({
  transfers,
  onPreview,
}: {
  transfers: VoiceTransfers;
  onPreview: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {transfers.error && <VoiceTransferFailure error={transfers.error} />}
      {transfers.tasks.map((task) => (
        <VoiceTransferFeedback
          key={task.id}
          task={task}
          busy={transfers.pending}
          onPreview={onPreview}
          onCancel={() => void transfers.cancel(task.id)}
          onDismiss={() => void transfers.run(() => transfers.dismiss(task.id))}
        />
      ))}
    </div>
  );
}
