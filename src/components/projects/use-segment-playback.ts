import { useMemo } from "react";
import { useChapterPlayback } from "@/components/projects/chapter-playback-provider";
import { useChapterAudio } from "@/hooks/use-chapter-audio";

export function useSegmentPlayback(
  projectId: string,
  chapterId: string,
  status: ReturnType<typeof useChapterAudio>["status"],
  player: ReturnType<typeof useChapterPlayback>["player"],
) {
  return useMemo(() => {
    if (status?.arrangement.stale) return null;
    const playable = new Set<string>();
    const firstUnit = new Map<string, number>();
    for (const unit of status?.units ?? []) {
      if (unit.mediaId == null) continue;
      playable.add(unit.segmentId);
      if (!firstUnit.has(unit.segmentId))
        firstUnit.set(unit.segmentId, unit.index);
    }
    if (!playable.size) return null;
    const playingId =
      player.state.active &&
      player.state.target?.projectId === projectId &&
      player.state.target.chapterId === chapterId &&
      player.state.target.runId === status?.run.id
        ? (player.state.unit?.segmentId ?? null)
        : null;
    return {
      playable,
      playingId,
      playing: player.state.playing,
      toggle: (segmentId: string) => {
        if (playingId === segmentId) player.toggle();
        else {
          const index = firstUnit.get(segmentId);
          if (index != null) player.start(index);
        }
      },
    };
  }, [
    status,
    player.state.active,
    player.state.unit,
    player.state.target,
    player.state.playing,
    projectId,
    chapterId,
    player.start,
    player.toggle,
  ]);
}
