import type {
  ChapterAudioBlocker_Serialize as ChapterAudioBlocker,
  ChapterAudioRunView_Serialize as ChapterAudioRunView,
  ChapterAudioStatusView_Serialize as ChapterAudioStatusView,
  Segment,
} from "@/lib/bindings";

/** 宿主仍可能对其执行或取消的任务状态。 */
export function chapterAudioActive(status: ChapterAudioRunView["status"]) {
  return status === "queued" || status === "running" || status === "cancelling";
}

export function hasCompleteAudio(status: ChapterAudioStatusView): boolean {
  return (
    status.run.status === "succeeded" &&
    status.units.some((unit) => !!unit.mediaId) &&
    status.units.every((unit) => unit.status === "empty" || !!unit.mediaId)
  );
}

/** 重录完成、等待用户决定的版本；其他状态返回 null。 */
export function pendingVersion(
  status: ChapterAudioStatusView | null,
): ChapterAudioStatusView | null {
  return status?.run.status === "succeeded" && status.run.adoption === "pending"
    ? status
    : null;
}

/** 只有当前采用且完整可播的版本可以导出。 */
export function exportableVersion(
  status: ChapterAudioStatusView | null,
): boolean {
  return (
    !!status && status.run.adoption === "adopted" && hasCompleteAudio(status)
  );
}

/**
 * 派生任务只统计实际需要处理的单元：沿用的音频在建立时即为已定，
 * 不进入进度，否则任务一开始就显示接近完成。
 */
export function derivedProgress(run: ChapterAudioRunView): {
  done: number;
  total: number;
} {
  const total = Math.max(run.unitCount - run.inheritedUnits, 0);
  const done = Math.min(
    Math.max(run.completedUnits - run.inheritedUnits, 0),
    total,
  );
  return { done, total };
}

/** 版本在列表中的角色：当前采用、待采用或历史。 */
export function versionRole(
  run: ChapterAudioRunView,
): "current" | "pending" | "history" {
  if (run.adoption === "adopted") return "current";
  return run.adoption === "pending" ? "pending" : "history";
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
