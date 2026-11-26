import { RoleSourceBlock } from "@/components/analysis/role-source-block";
import type { ByteRange, Segment, TextLine } from "@/lib/bindings";
import type { ComponentProps } from "react";
import type { ChapterPlayerSession } from "@/hooks/use-chapter-player";
import type { useSourceActions } from "./source-actions";
import { SourceLine } from "./source-line";

export function WorkspaceSourceLine({
  line,
  projectId,
  chapterId,
  playback,
  evidence,
  analysis,
  characters,
  selectedId,
  showRoles,
  actions,
  onLineSelect,
  onSegmentSelect,
}: {
  line: TextLine;
  projectId: string;
  chapterId: string;
  playback: Pick<ChapterPlayerSession["state"], "target" | "unit">;
  evidence: { chapterId: string; range: ByteRange } | null;
  analysis: Segment[] | null;
  characters: ComponentProps<typeof RoleSourceBlock>["characters"];
  selectedId: string | null;
  showRoles: boolean;
  actions: ReturnType<typeof useSourceActions>;
  onLineSelect: (line: number, anchor: HTMLElement) => void;
  onSegmentSelect: (segment: Segment) => void;
}) {
  const highlight =
    (playback.target?.projectId === projectId &&
    playback.target.chapterId === chapterId
      ? playback.unit?.range
      : null) ?? (evidence?.chapterId === chapterId ? evidence.range : null);
  return (
    <SourceLine
      line={line}
      highlight={highlight}
      onSelect={(event) => onLineSelect(line.line, event.currentTarget)}
    >
      {analysis && (
        <RoleSourceBlock
          line={line}
          segments={analysis}
          characters={characters}
          selectedId={selectedId}
          hoveredId={
            actions.target?.kind === "segment"
              ? actions.target.segment.id
              : null
          }
          showRoles={showRoles}
          onSelect={onSegmentSelect}
          onHover={actions.hover}
          onLeave={actions.leave}
          onOpen={(segment, anchor, line) => {
            actions.cancelTimer();
            actions.show({
              kind: "segment",
              segment,
              anchor,
              line,
              pinned: true,
            });
          }}
          highlight={highlight}
        />
      )}
    </SourceLine>
  );
}
