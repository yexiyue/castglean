import { useEffect, useState } from "react";
import type { ChapterAudio } from "@/hooks/use-chapter-audio";
import { type ChapterExportView, commands } from "@/lib/bindings";
import { exportableVersion } from "@/lib/chapter-audio";

/** Export follows the chosen version and samples the ongoing export by job id. */
export function useChapterAudioExport(audio: ChapterAudio) {
  const [exported, setExported] = useState<ChapterExportView | null>(null);
  const [exportStarting, setExportStarting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  useEffect(() => {
    if (exported?.status !== "succeeded") return;
    const timer = window.setTimeout(() => {
      setExported((current) => (current === exported ? null : current));
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [exported]);

  const exportId = exported?.status === "running" ? exported.id : null;
  useEffect(() => {
    if (!exportId) return;
    let alive = true;
    const poll = window.setInterval(() => {
      void commands
        .chapterAudioExportStatus(exportId)
        .then((value) => {
          if (alive) setExported(value);
        })
        .catch(() => {
          if (alive) setExportFailed(true);
        });
    }, 500);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [exportId]);
  const exportStatus =
    audio.pending && !audio.viewing ? audio.priorComplete : audio.status;
  const startExport = async () => {
    if (!exportStatus || exportStarting) return;
    setExportStarting(true);
    setExportFailed(false);
    try {
      setExported(
        await commands.chapterAudioExport(audio.projectId, exportStatus.run.id),
      );
    } catch {
      setExportFailed(true);
    } finally {
      setExportStarting(false);
    }
  };
  const exportable =
    !!exportStatus &&
    exportableVersion(exportStatus) &&
    !exportStatus.arrangement.stale &&
    !exportStarting &&
    exported?.status !== "running";

  async function cancelExport() {
    if (exported?.status !== "running") return;
    try {
      await commands.chapterAudioExportCancel(exported.id);
    } catch {
      setExportFailed(true);
    }
  }

  return {
    exported,
    exportStatus,
    exportable,
    exportFailed,
    startExport,
    cancelExport,
  };
}
