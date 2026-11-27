import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useChapterAudio } from "@/hooks/use-chapter-audio";
import {
  type ChapterAudioDeviceChoice,
  type ChapterAudioInput,
  type ChapterAudioMode,
  commands,
  type VoiceRef,
} from "@/lib/bindings";
import { useWorkspaceState } from "@/lib/desktop-session";
import { useChapterPlayback } from "./chapter-playback-provider";
import { useSegmentPlayback } from "./use-segment-playback";

/** Owns chapter audio preferences and publishes the selected chapter to the desktop player. */
export function useWorkspaceChapterAudio({
  project,
  chapterId,
  visible,
  readOnly,
  analysisVersion,
  analysisRevision,
  afterPauseExit,
  isCurrentChapter,
}: {
  project: { id: string; title: string; revision: number };
  chapterId: string;
  visible: boolean;
  readOnly: boolean;
  analysisVersion: string | null | undefined;
  analysisRevision: number | undefined;
  afterPauseExit: (action: () => void | Promise<void>) => Promise<boolean>;
  isCurrentChapter: () => boolean;
}) {
  const [selectedAudioMode, setAudioMode] =
    useWorkspaceState<ChapterAudioMode | null>(
      project.id,
      `chapterAudioMode:${chapterId}`,
      null,
    );
  const [audioDevice, setAudioDevice] =
    useWorkspaceState<ChapterAudioDeviceChoice | null>(
      project.id,
      `chapterAudioDevice:${chapterId}`,
      null,
    );
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    if (!isTauri() || readOnly) return;
    let current = true;
    void commands
      .desktopPlatform()
      .then((platform) => {
        if (current) setIsMac(platform === "macos");
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [readOnly]);
  const audioMode = selectedAudioMode ?? "multi_role";
  useEffect(() => {
    if (selectedAudioMode || readOnly || !isTauri()) return;
    let current = true;
    void commands
      .chapterAudioStatus(project.id, chapterId, null, null, false)
      .then((result) => {
        if (current && result)
          setAudioMode((value) => value ?? result.run.mode);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [selectedAudioMode, readOnly, project.id, chapterId, setAudioMode]);
  const [narratorVoice, setNarratorVoice] = useWorkspaceState<VoiceRef | null>(
    project.id,
    `chapterNarrator:${chapterId}`,
    null,
  );
  const audioInput = useMemo<ChapterAudioInput>(
    () =>
      audioMode === "narrator"
        ? { mode: "narrator", voice: narratorVoice, device: audioDevice }
        : { mode: "multi_role", device: audioDevice },
    [audioMode, narratorVoice, audioDevice],
  );
  const audio = useChapterAudio(project.id, chapterId, audioInput, {
    visible,
    analysisVersion,
    workflowRevision: `${project.revision}:${analysisRevision ?? ""}`,
  });
  const currentDevice = audio.viewing ? null : audio.status?.run.device;
  useEffect(() => {
    if (isMac && currentDevice === "metal")
      setAudioDevice((value) => value ?? "metal");
  }, [isMac, currentDevice, setAudioDevice]);
  const currentNarrator = narratorVoice ?? audio.frozenNarrator;
  const {
    player,
    setInlineControls,
    setSource,
    returnTarget,
    requestReturn,
    clearReturn,
  } = useChapterPlayback();
  const inlineAudio = visible && !readOnly && audio.desktop;
  useEffect(() => {
    if (!inlineAudio) return;
    setInlineControls(true);
    return () => setInlineControls(false);
  }, [inlineAudio, setInlineControls]);
  useEffect(() => {
    const status = audio.status;
    setSource({
      status:
        status?.run.projectId === project.id &&
        status.run.chapterId === chapterId
          ? status
          : null,
      projectTitle: project.title,
    });
  }, [audio.status, chapterId, project.id, project.title, setSource]);
  useEffect(() => () => setSource(null), [setSource]);
  const segmentPlayback = useSegmentPlayback(
    project.id,
    chapterId,
    audio.status,
    player,
  );
  const audioDialogTrigger = useRef<HTMLElement | false | null>(null);
  const [audioDialog, setAudioDialog] = useState<{
    chapterId: string;
    view: "settings" | "check";
  } | null>(null);
  const activeAudioDialog =
    audioDialog?.chapterId === chapterId && visible ? audioDialog.view : null;

  function showAudioDialog(
    view: "settings" | "check",
    trigger = document.activeElement,
  ) {
    if (!activeAudioDialog)
      audioDialogTrigger.current =
        trigger instanceof HTMLElement && trigger !== document.body
          ? trigger
          : null;
    setAudioDialog({ chapterId: chapterId, view });
  }

  function openChapterAudioSettings() {
    void afterPauseExit(() => showAudioDialog("settings"));
  }

  function closeAudioDialogFor(action: () => void) {
    audioDialogTrigger.current = false;
    setAudioDialog(null);
    action();
  }

  function startChapterAudio(restart?: boolean) {
    const trigger = document.activeElement;
    void afterPauseExit(async () => {
      const result = await audio.start(restart);
      if (result === "blocked" && isCurrentChapter())
        showAudioDialog("check", trigger);
    });
  }

  return {
    audio,
    audioMode,
    selectedAudioMode,
    setAudioMode,
    audioDevice,
    isMac,
    setAudioDevice,
    setNarratorVoice,
    currentNarrator,
    player,
    returnTarget,
    requestReturn,
    clearReturn,
    segmentPlayback,
    activeAudioDialog,
    audioDialogTrigger,
    setAudioDialog,
    showAudioDialog,
    openChapterAudioSettings,
    closeAudioDialogFor,
    startChapterAudio,
  };
}
