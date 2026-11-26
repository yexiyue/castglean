import { Trans, useLingui } from "@lingui/react/macro";
import { ScanTextIcon } from "lucide-react";
import { CandidateReview } from "@/components/analysis/candidate-review";
import { SegmentInspector } from "@/components/analysis/segment-inspector";
import { AppState } from "@/components/app-state";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { ChapterAudio } from "@/hooks/use-chapter-audio";
import type { ChapterPlayerSession } from "@/hooks/use-chapter-player";
import type { SegmentEditDrafts } from "@/hooks/use-segment-edit-drafts";
import type {
  AnalysisSnapshot,
  ByteRange,
  Chapter,
  Character,
  Segment,
} from "@/lib/bindings";
import type { CandidateOperationRegistry } from "@/lib/candidate-operations";
import { hasCompleteAudio } from "@/lib/chapter-audio";
import { cn } from "@/lib/utils";
import { ChapterVoicePanel } from "./chapter-voice-panel";

export function ChapterInspector({
  projectId,
  chapter,
  snapshot,
  characters,
  inspectedSegment,
  inspectedRange,
  attributionPending,
  edits,
  candidateId,
  candidateOperations,
  pauseOpen,
  audio,
  player,
  onCandidateSaved,
  onSaved,
  onEditBoundary,
  onLocate,
}: {
  projectId: string;
  chapter: Chapter;
  snapshot: AnalysisSnapshot | null;
  characters: Character[];
  inspectedSegment: Segment | null;
  inspectedRange: ByteRange | undefined;
  attributionPending: boolean;
  edits: SegmentEditDrafts;
  candidateId: string | null;
  candidateOperations: CandidateOperationRegistry;
  pauseOpen: boolean;
  audio: ChapterAudio;
  player: Pick<ChapterPlayerSession, "start">;
  onCandidateSaved: () => Promise<void>;
  onSaved: () => Promise<void>;
  onEditBoundary: (segment: Segment, snapshot: AnalysisSnapshot) => void;
  onLocate: (range: ByteRange) => void;
}) {
  const { t } = useLingui();
  const inspectedUnit = audio.status?.arrangement.stale
    ? null
    : audio.status?.units.find(
        (u) =>
          inspectedRange &&
          u.range.start < inspectedRange.end &&
          u.range.end > inspectedRange.start,
      );
  // 重录此段：只对完整、与当前计划一致的当前采用版本开放，重录所选归属片段的全部单元。
  const retake =
    inspectedUnit?.status === "done" &&
    !audio.restartRequired &&
    audio.status?.run.adoption === "adopted" &&
    hasCompleteAudio(audio.status)
      ? {
          run: audio.status.run,
          units: audio.status.units
            .filter(
              (unit) =>
                unit.segmentId === inspectedUnit.segmentId &&
                unit.status === "done",
            )
            .map((unit) => unit.index),
        }
      : null;
  const candidateReviewId = snapshot ? candidateId : null;
  const showSegment = !!(inspectedSegment && snapshot?.versionId);
  const inspectorEmpty = !candidateReviewId && !showSegment && !inspectedUnit;
  return (
    <div
      className={cn(
        "min-w-0 flex-col gap-4 p-4",
        pauseOpen ? "hidden" : "flex",
        inspectorEmpty && "flex-1",
      )}
    >
      {inspectedUnit && (
        <>
          <section className="flex flex-col items-start gap-2">
            <h3 className="text-sm font-semibold wrap-anywhere">
              {inspectedUnit.characterName ?? t`旁白`}
            </h3>
            <p className="text-xs wrap-anywhere text-muted-foreground">
              {inspectedUnit.voice} ·{" "}
              {inspectedUnit.mediaId
                ? t`音频已生成`
                : inspectedUnit.status === "failed"
                  ? t`生成失败`
                  : t`等待生成`}
              {inspectedUnit.durationMs != null &&
                ` · ${(inspectedUnit.durationMs / 1000).toFixed(2)}s`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!inspectedUnit.mediaId}
                onClick={() => void player.start(inspectedUnit.index)}
              >
                <Trans>从这里播放</Trans>
              </Button>
              {retake && (
                <Button
                  size="sm"
                  data-action="chapter-audio-retake"
                  disabled={!!audio.active || audio.starting}
                  title={t`按相同的声音重新合成这一段，完成后由你决定是否采用`}
                  onClick={() => void audio.retake(retake.run.id, retake.units)}
                >
                  <Trans>重录此段</Trans>
                </Button>
              )}
            </div>
          </section>
          {(candidateReviewId || showSegment) && <Separator />}
        </>
      )}
      {candidateReviewId && snapshot ? (
        <CandidateReview
          key={`${projectId}:${candidateReviewId}`}
          projectId={projectId}
          chapterId={chapter.id}
          candidateId={candidateReviewId}
          characters={characters}
          revision={snapshot.revision}
          operations={candidateOperations}
          onSaved={onCandidateSaved}
          onLocate={onLocate}
        />
      ) : showSegment ? (
        <>
          <SegmentInspector
            edits={edits}
            projectId={projectId}
            chapterId={chapter.id}
            snapshot={snapshot}
            onEditBoundary={onEditBoundary}
            segment={inspectedSegment}
            characters={characters}
            onSaved={onSaved}
            onLocate={onLocate}
          />
          <Separator />
          <ChapterVoicePanel
            key={projectId}
            projectId={projectId}
            chapter={chapter}
            characters={characters}
            segment={inspectedSegment}
            attributionPending={attributionPending}
            requestedTarget={null}
          />
        </>
      ) : inspectorEmpty ? (
        <AppState
          className="px-0"
          icon={ScanTextIcon}
          title={<Trans>选择正文片段</Trans>}
        />
      ) : null}
    </div>
  );
}
