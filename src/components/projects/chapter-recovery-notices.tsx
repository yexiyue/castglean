import { Trans } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import type { Chapter_Serialize, Segment } from "@/lib/bindings";
import type { CandidateOperation } from "@/lib/candidate-operations";

export function ChapterRecoveryNotices({
  chapters,
  candidateOperations,
  segmentEdits,
  candidateIds,
  onCandidate,
  onSegment,
  onNewCandidate,
}: {
  chapters: Chapter_Serialize[];
  candidateOperations: CandidateOperation[];
  segmentEdits: ReadonlyArray<{
    target?: { chapterId: string; segment: Segment } | null;
    confirmed?: boolean;
  }>;
  candidateIds?: string[];
  onCandidate: (chapterId: string, candidateId: string) => void;
  onSegment: (chapterId: string, segment: Segment) => void;
  onNewCandidate: (candidateId: string) => void;
}) {
  return (
    <>
      {candidateOperations.map((operation) => {
        const target = chapters.find((item) => item.id === operation.chapterId);
        return (
          <div
            key={operation.commandId}
            role="status"
            className="flex items-center gap-2 border-b px-3 py-2 text-xs"
          >
            <span className="flex-1">
              {target ? (
                operation.phase === "read" ? (
                  <Trans>候选操作已保存，待读取：{target.title}</Trans>
                ) : (
                  <Trans>候选操作待确认：{target.title}</Trans>
                )
              ) : (
                <Trans>候选操作的原章节已变化，请重新读取工程。</Trans>
              )}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!target}
              onClick={() =>
                onCandidate(operation.chapterId, operation.candidateId)
              }
            >
              <Trans>查看并恢复</Trans>
            </Button>
          </div>
        );
      })}
      {segmentEdits.map((state) => {
        const target = state.target;
        if (!target) return null;
        const targetChapter = chapters.find(
          (item) => item.id === target.chapterId,
        );
        return (
          <div
            key={`${target.chapterId}:${target.segment.id}`}
            role="status"
            className="flex items-center gap-2 border-b px-3 py-2 text-xs"
          >
            <span className="flex-1">
              {targetChapter ? (
                state.confirmed ? (
                  <Trans>片段修改已保存，待读取：{targetChapter.title}</Trans>
                ) : (
                  <Trans>片段修改待确认：{targetChapter.title}</Trans>
                )
              ) : (
                <Trans>片段修改的原章节已变化，请重新读取工程。</Trans>
              )}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!targetChapter}
              onClick={() => onSegment(target.chapterId, target.segment)}
            >
              <Trans>查看并恢复</Trans>
            </Button>
          </div>
        );
      })}
      {candidateIds?.map((id) => (
        <Button
          key={id}
          size="sm"
          variant="ghost"
          className="shrink-0 justify-start border-b"
          onClick={() => onNewCandidate(id)}
        >
          <Trans>有新的分析候选，查看变化</Trans>
        </Button>
      ))}
    </>
  );
}
