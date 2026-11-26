import { Trans } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { StudioJobFeedback } from "@/components/voices/studio-job-feedback";
import { useVoicePlayer } from "@/components/voices/voice-player";
import type { VoiceStudio } from "@/hooks/use-voice-studio";
import {
  type ByteRange,
  type Chapter,
  commands,
  type ModelEntry,
  type VoiceRef,
} from "@/lib/bindings";
import { playVoiceRef, sameVoice } from "@/lib/voice-audition";

export function useChapterVoiceAudition({
  projectId,
  chapter,
  key,
  sourceRange,
  studio,
  models,
}: {
  projectId: string;
  chapter: Chapter;
  key: string;
  sourceRange: ByteRange | null | undefined;
  studio: VoiceStudio;
  models: ModelEntry[];
}) {
  const player = useVoicePlayer();
  const readingAudition = useRef(false);
  const [auditionReading, setAuditionReading] = useState(false);
  const [auditionReadFailed, setAuditionReadFailed] = useState<string | null>(
    null,
  );
  const auditionRange = sourceRange ?? {
    start: chapter.start,
    end: chapter.end,
  };
  const auditionScope = JSON.stringify([
    "chapter-voice",
    projectId,
    chapter.id,
    key,
    auditionRange.start,
    auditionRange.end,
  ]);
  async function generateAudition(choice: VoiceRef) {
    if (readingAudition.current || choice.kind !== "preset") return;
    readingAudition.current = true;
    setAuditionReading(true);
    setAuditionReadFailed(null);
    try {
      const excerpt = await commands.chapterAnalysisExcerpt(
        projectId,
        chapter.id,
        auditionRange,
      );
      const text = Array.from(excerpt.text.trim()).slice(0, 500).join("");
      if (!text || text.includes("\0")) {
        setAuditionReadFailed(auditionScope);
        return;
      }
      playVoiceRef({
        voice: choice,
        studio,
        player,
        models,
        scope: auditionScope,
        text,
      });
    } catch {
      setAuditionReadFailed(auditionScope);
    } finally {
      readingAudition.current = false;
      setAuditionReading(false);
    }
  }
  return {
    player,
    scope: auditionScope,
    reading: auditionReading,
    readFailed: auditionReadFailed === auditionScope,
    generate: generateAudition,
  };
}

export function ChapterVoiceAuditions({
  studio,
  models,
  audition,
  visible,
  busy,
  voice,
  bind,
}: {
  studio: VoiceStudio;
  models: ModelEntry[];
  audition: ReturnType<typeof useChapterVoiceAudition>;
  visible: boolean;
  busy: boolean;
  voice: VoiceRef | null | undefined;
  bind?: (voice: VoiceRef) => void;
}) {
  const { player, scope: auditionScope, readFailed } = audition;
  const auditions = visible
    ? studio.jobs.filter((job) => studio.scopeForJob(job.id) === auditionScope)
    : [];
  return (
    <>
      {readFailed && (
        <p role="alert" className="text-xs text-destructive">
          <Trans>无法读取可用于试听的原文。</Trans>
        </p>
      )}
      {auditions.length > 0 && (
        <div className="flex min-w-0 flex-col gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            <Trans>试听记录</Trans>
          </h4>
          {studio.error && (
            <p role="alert" className="text-xs text-destructive">
              <Trans>音色操作未完成</Trans>
            </p>
          )}
          {[...auditions].reverse().map((job) => {
            const { request } = job;
            if (request.kind !== "audition" || request.voice.kind !== "preset")
              return null;
            const presetId = request.voice.voice;
            const model = models.find(
              (entry) =>
                entry.backend === request.backend &&
                entry.model === request.model,
            );
            const name =
              model?.voice_catalog.find((entry) => entry.id === presetId)
                ?.name ?? presetId;
            const choice: VoiceRef = {
              kind: "preset",
              backend: request.backend,
              model: request.model,
              voice: presetId,
            };
            return (
              <StudioJobFeedback
                key={job.id}
                job={job}
                busy={busy || studio.pending}
                compact={{
                  name,
                  model: model?.name ?? request.model,
                  playing: !!job.audio && player.playingId === job.audio,
                  onBind:
                    bind && (!voice || !sameVoice(voice, choice))
                      ? () => bind(choice)
                      : undefined,
                }}
                onPlay={() => {
                  if (job.audio)
                    void player.toggle(job.audio, name, request.text);
                }}
                onCancel={() =>
                  void studio.run(() => commands.cancelVoiceJob(job.id))
                }
                onRetry={() => void studio.start(request, null, auditionScope)}
                onDismiss={() =>
                  void studio.run(async () => {
                    if (job.audio) await player.stop();
                    await commands.dismissVoiceJob(job.id);
                  })
                }
              />
            );
          })}
        </div>
      )}
    </>
  );
}
