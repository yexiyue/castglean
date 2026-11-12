import type {
  ChapterAudioBlocker_Serialize as ChapterAudioBlocker,
  ChapterAudioRunView_Serialize as ChapterAudioRunView,
  Segment,
} from "@/lib/bindings";

/** 宿主仍可能对其执行或取消的任务状态。 */
export function chapterAudioActive(status: ChapterAudioRunView["status"]) {
  return status === "queued" || status === "running" || status === "cancelling";
}

/**
 * 异常驱动审阅口径：归属未定（未知/歧义）且未经人工处理的片段才提示待处理；
 * 已明确归属的片段不因未逐段确认而进入待检查。
 */
export function segmentPending(segment: Segment): boolean {
  return (
    segment.review === "unreviewed" &&
    (segment.attribution.state === "unknown" ||
      segment.attribution.state === "ambiguous")
  );
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
