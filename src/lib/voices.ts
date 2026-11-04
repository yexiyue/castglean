/** 应用 IPC 的接收形态；不把反序列化输入形态混入界面状态。 */
export type {
  LibraryVoice_Serialize as LibraryVoice,
  VoiceError_Serialize as VoiceError,
  VoiceImportPreview_Serialize as VoiceImportPreview,
  VoiceInventory_Serialize as VoiceInventory,
  VoiceTaskSnapshot_Serialize as VoiceTaskSnapshot,
} from "@/lib/bindings";
