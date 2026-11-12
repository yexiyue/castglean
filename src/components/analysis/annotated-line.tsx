import { useLingui } from "@lingui/react/macro";
import { Pause, Play } from "lucide-react";
import type { Segment, TextLine } from "@/lib/bindings";
import { segmentPending } from "@/lib/chapter-audio";
import { cn } from "@/lib/utils";

/** 片段就近播放能力；由工作台装配，标注组件不感知播放实现。 */
export interface SegmentPlayback {
  /** 可播片段 id（至少一个单元已有产物）。 */
  playable: ReadonlySet<string>;
  /** 正在播放的片段 id；空闲为 null。 */
  playingId: string | null;
  /** 正在播放的片段再次点击暂停/继续，否则从该片段起播。 */
  toggle: (segmentId: string) => void;
}

export interface SegmentSpeaker {
  id: string;
  displayName: string;
}

/**
 * Decorations never contribute characters to source selection or copying.
 * 段首说话人标注与播放按钮常驻片段首行；点击片段或标注进入归属检查。
 */
export function AnnotatedLine({
  line,
  segments,
  selectedId,
  onSelect,
  highlight,
  characters,
  playback,
}: {
  line: TextLine;
  segments: Segment[];
  selectedId: string | null;
  onSelect: (segment: Segment) => void;
  highlight?: { start: number; end: number } | null;
  characters: SegmentSpeaker[];
  playback?: SegmentPlayback | null;
}) {
  const { t } = useLingui();
  const bytes = new TextEncoder().encode(line.text);
  const decoder = new TextDecoder();
  const names = new Map(
    characters.map((character) => [character.id, character.displayName]),
  );
  const visible = segments.filter(
    (s) => s.range.start < line.end && s.range.end > line.start,
  );
  function fragment(start: number, end: number) {
    const text = (a: number, b: number) =>
      decoder.decode(bytes.subarray(a - line.start, b - line.start));
    if (!highlight || highlight.start >= end || highlight.end <= start)
      return text(start, end);
    const a = Math.max(start, highlight.start),
      b = Math.min(end, highlight.end);
    return (
      <>
        {text(start, a)}
        <mark className="bg-warning/20 text-inherit" data-source-evidence="">
          {text(a, b)}
        </mark>
        {text(b, end)}
      </>
    );
  }
  function speakerLabel(segment: Segment) {
    switch (segment.attribution.state) {
      case "narrator":
        return t`旁白`;
      case "resolved":
        return names.get(segment.attribution.character_id) ?? t`未知`;
      case "unknown":
        return t`未知`;
      case "ambiguous":
        return t`歧义`;
    }
  }
  /** 段首标注：说话人 + 就近播放；hover 显示播放，点击进入检查器。 */
  function lead(segment: Segment) {
    const pending = segmentPending(segment);
    const playing = playback?.playingId === segment.id;
    return (
      <span className="mr-1 inline-flex items-center gap-1 align-middle select-none">
        {playback?.playable.has(segment.id) && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground inline-flex size-5 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={playing ? t`暂停播放` : t`播放此片段`}
            onClick={(event) => {
              event.stopPropagation();
              playback.toggle(segment.id);
            }}
          >
            {playing ? (
              <Pause className="size-3" aria-hidden="true" />
            ) : (
              <Play className="size-3" aria-hidden="true" />
            )}
          </button>
        )}
        <button
          type="button"
          className={cn(
            "inline-flex h-5 max-w-40 items-center rounded-sm px-1.5 text-[11px] font-medium",
            pending
              ? "bg-warning/10 text-warning"
              : "bg-muted text-muted-foreground",
          )}
          title={pending ? t`归属未定，点击处理` : t`点击查看归属`}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(segment);
          }}
        >
          <span className="truncate">{speakerLabel(segment)}</span>
        </button>
      </span>
    );
  }
  let cursor = line.start;
  const parts = [];
  for (const s of visible) {
    const start = Math.max(s.range.start, line.start),
      end = Math.min(s.range.end, line.end);
    if (start > cursor)
      parts.push(<span key={`gap-${cursor}`}>{fragment(cursor, start)}</span>);
    const startsHere = s.range.start >= line.start;
    const playing = playback?.playingId === s.id;
    parts.push(
      // biome-ignore lint/a11y/useSemanticElements: Source annotations must wrap inline across paragraphs; role, focus and keyboard behavior are explicit.
      <span
        role="button"
        tabIndex={0}
        key={s.id}
        data-segment-id={s.id}
        aria-label={t`检查此片段`}
        aria-pressed={s.id === selectedId}
        className={cn(
          "focus-visible:ring-ring rounded-sm bg-transparent text-inherit outline-none focus-visible:ring-2",
          segmentPending(s) &&
            "decoration-warning/50 underline decoration-dotted underline-offset-4",
          playing && "bg-primary/10",
          s.id === selectedId && "bg-accent/50",
        )}
        onClick={() => onSelect(s)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(s);
          }
        }}
      >
        {startsHere && lead(s)}
        {fragment(start, end)}
      </span>,
    );
    cursor = end;
  }
  if (cursor < line.end)
    parts.push(
      <span key={`tail-${cursor}`}>{fragment(cursor, line.end)}</span>,
    );
  return (
    <div
      data-source-row={line.line}
      data-source-byte={line.start}
      className="flex items-start gap-3 px-3 py-1"
    >
      <button
        type="button"
        className="text-muted-foreground w-10 shrink-0 py-1 text-right text-xs tabular-nums select-none"
        aria-label={t`选择第 ${line.line + 1} 行`}
        onClick={() => {
          if (visible[0]) onSelect(visible[0]);
        }}
      >
        {line.line + 1}
      </button>
      <pre
        data-source-line={line.line}
        className="min-w-0 flex-1 font-sans text-sm leading-7 wrap-break-word whitespace-pre-wrap select-text"
      >
        {parts}
      </pre>
    </div>
  );
}
