import type {
  ChapterAudioBlocker_Serialize as ChapterAudioBlocker,
  ChapterAudioRunView_Serialize as ChapterAudioRunView,
} from "@/lib/bindings";

/** 宿主仍可能对其执行或取消的任务状态。 */
export function chapterAudioActive(status: ChapterAudioRunView["status"]) {
  return status === "queued" || status === "running" || status === "cancelling";
}

/** 宿主以值抛出领域错误：`"busy"` 等字符串，或携带阻塞清单的对象。 */
export function blockersOf(cause: unknown): ChapterAudioBlocker[] | null {
  if (typeof cause !== "object" || cause === null || !("blocked" in cause))
    return null;
  const blocked = (cause as { blocked?: { blockers?: unknown } }).blocked;
  return Array.isArray(blocked?.blockers)
    ? (blocked.blockers as ChapterAudioBlocker[])
    : null;
}
