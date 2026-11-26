import { useEffect, useState } from "react";
import { commands } from "@/lib/bindings";
import type { layoutChapterTrack } from "@/lib/chapter-track-layout";

export function useChapterTrackMedia(
  projectId: string,
  runId: string | undefined,
  visible: ReturnType<typeof layoutChapterTrack>["items"],
  open: boolean,
) {
  const [summaryWindow, setSummaryWindow] = useState<{
    runId: string;
    items: Record<number, string>;
  }>();
  const from = visible[0]?.unit.index,
    to = visible[visible.length - 1]?.unit.index;
  useEffect(() => {
    if (!open || !runId || from == null || to == null) return;
    let alive = true;
    void commands
      .chapterAudioSummaries(
        projectId,
        runId,
        from,
        Math.min(128, to - from + 1),
      )
      .then((items) => {
        if (alive)
          setSummaryWindow({
            runId,
            items: Object.fromEntries(
              items.map((item) => [item.index, item.text]),
            ),
          });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId, runId, from, to, open]);
  const [waveforms, setWaveforms] = useState<Record<string, number[]>>({});
  const mediaKey = JSON.stringify(
    visible
      .flatMap(({ unit }) => (unit.mediaId ? [unit.mediaId] : []))
      .slice(0, 64),
  );
  useEffect(() => {
    if (!open) return;
    const ids: string[] = JSON.parse(mediaKey);
    const missing = ids.filter((id) => !(id in waveforms));
    if (!missing.length) return;
    let alive = true;
    void commands
      .chapterAudioWaveforms(missing)
      .then((result) => {
        if (!alive) return;
        setWaveforms((previous) =>
          Object.fromEntries(
            Object.entries({
              ...previous,
              ...Object.fromEntries(
                missing.map((id) => [
                  id,
                  (result[id] ?? []).filter((peak) => peak !== null),
                ]),
              ),
            }).slice(-256),
          ),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, mediaKey, waveforms]);
  return {
    summaries:
      summaryWindow?.runId === runId ? (summaryWindow?.items ?? {}) : {},
    waveforms,
  };
}
