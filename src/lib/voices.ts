/** 应用 IPC 的接收形态；不把反序列化输入形态混入界面状态。 */
export type {
  LibraryVoice_Serialize as LibraryVoice,
  VoiceError_Serialize as VoiceError,
  VoiceImportPreview_Serialize as VoiceImportPreview,
  VoiceInventory_Serialize as VoiceInventory,
  VoiceTaskSnapshot_Serialize as VoiceTaskSnapshot,
} from "@/lib/bindings";

export function formatVoiceDuration(
  duration: number | null | undefined,
  locale: string,
): string | null {
  if (duration == null || !Number.isFinite(duration) || duration < 0)
    return null;
  return duration.toLocaleString(locale, { maximumFractionDigits: 1 });
}

export function formatVoiceSize(
  bytes: number | null | undefined,
  locale: string,
): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  return `${(bytes / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} KiB`;
}
