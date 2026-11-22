import { useLingui } from "@lingui/react/macro";
import { CircleHelpIcon } from "lucide-react";
import type { Segment, TextLine } from "@/lib/bindings";
import { segmentPending } from "@/lib/chapter-audio";
import { cn } from "@/lib/utils";

export interface SegmentPlayback {
  playable: ReadonlySet<string>;
  playingId: string | null;
  playing: boolean;
  toggle: (segmentId: string) => void;
}
export interface SegmentSpeaker {
  id: string;
  displayName: string;
}

const speakerColors = [
  "bg-sky-600 dark:bg-sky-400",
  "bg-violet-600 dark:bg-violet-400",
  "bg-teal-600 dark:bg-teal-400",
  "bg-rose-600 dark:bg-rose-400",
  "bg-amber-600 dark:bg-amber-400",
  "bg-indigo-600 dark:bg-indigo-400",
];

function roleKey(segment: Segment | undefined) {
  return segment?.attribution.state === "resolved"
    ? `speaker:${segment.attribution.character_id}`
    : segment?.attribution.state;
}

export function speakerLabel(
  segment: Segment,
  characters: readonly SegmentSpeaker[],
  labels: {
    narrator: string;
    unknown: string;
    ambiguous: string;
    unassigned: string;
  },
) {
  const attribution = segment.attribution;
  switch (attribution.state) {
    case "narrator":
      return labels.narrator;
    case "ambiguous":
      return labels.ambiguous;
    case "unassigned":
      return labels.unassigned;
    case "unknown":
      return labels.unknown;
    case "resolved":
      return (
        characters.find(({ id }) => id === attribution.character_id)
          ?.displayName ?? labels.unknown
      );
  }
}

type Range = { start: number; end: number };

type Props = {
  line: TextLine;
  segments: Segment[];
  characters: SegmentSpeaker[];
  showRoles: boolean;
  selectedId: string | null;
  hoveredId: string | null;
  highlight?: Range | null;
  onHover: (segment: Segment, anchor: HTMLElement, line: number) => void;
  onLeave: () => void;
  onOpen: (segment: Segment, anchor: HTMLElement, line: number) => void;
  onSelect: (segment: Segment) => void;
};

/** Inline source leaves keep line layout and original byte coordinates. */
export function RoleSourceBlock({
  line,
  segments,
  characters,
  showRoles,
  selectedId,
  hoveredId,
  highlight,
  onHover,
  onLeave,
  onOpen,
  onSelect,
}: Props) {
  const { t } = useLingui();
  const bytes = new TextEncoder().encode(line.text);
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  const slice = (from: number, to: number) =>
    decoder.decode(bytes.subarray(from - line.start, to - line.start));
  const fragments: (Range & { segment?: Segment; showRole?: boolean })[] = [];
  let cursor = line.start;
  for (const [index, segment] of segments.entries()) {
    if (segment.range.end <= line.start) continue;
    if (segment.range.start >= line.end) break;
    const start = Math.max(cursor, segment.range.start);
    const end = Math.min(segment.range.end, line.end);
    if (start >= end) continue;
    if (cursor < start) fragments.push({ start: cursor, end: start });
    fragments.push({
      start,
      end,
      segment,
      showRole:
        start === segment.range.start &&
        roleKey(segment) !== roleKey(segments[index - 1]),
    });
    cursor = end;
  }
  if (cursor < line.end) fragments.push({ start: cursor, end: line.end });
  return fragments.map(({ start, end, segment, showRole }) => {
    const name =
      segment &&
      speakerLabel(segment, characters, {
        narrator: t`旁白`,
        unknown: t`未知`,
        ambiguous: t`歧义`,
        unassigned: t`未标注`,
      });
    const pending = !!segment && segmentPending(segment);
    const characterId =
      segment?.attribution.state === "resolved"
        ? segment.attribution.character_id
        : null;
    const colorIndex =
      characterId === null
        ? 0
        : Array.from(characterId).reduce(
            (hash, digit) => (hash * 31 + (digit.codePointAt(0) ?? 0)) >>> 0,
            0,
          ) % speakerColors.length;
    const visibleMarker =
      !!segment &&
      start === segment.range.start &&
      (pending || (showRoles && showRole && characterId !== null));
    const from = Math.max(start, highlight?.start ?? end);
    const to = Math.min(end, highlight?.end ?? start);
    const content =
      from < to ? (
        <>
          {slice(start, from)}
          <mark className="bg-primary/15 text-inherit">{slice(from, to)}</mark>
          {slice(to, end)}
        </>
      ) : (
        slice(start, end)
      );
    if (!segment || segment.kind === "unassigned" || !slice(start, end).trim())
      return <span key={start}>{content}</span>;
    return (
      <span key={start} className="relative">
        {visibleMarker && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={pending ? t`归属待确认` : name}
            aria-haspopup="dialog"
            className="absolute top-1 left-0 inline-flex -translate-y-full items-center gap-1 rounded-sm bg-background px-0.5 text-xs leading-none whitespace-nowrap text-muted-foreground select-none"
            onPointerEnter={(event) =>
              onHover(segment, event.currentTarget, line.line)
            }
            onPointerLeave={onLeave}
            onClick={(event) => onOpen(segment, event.currentTarget, line.line)}
          >
            {pending ? (
              <CircleHelpIcon className="size-3 text-destructive" />
            ) : (
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  speakerColors[colorIndex],
                )}
              />
            )}
            {showRoles && !pending && (
              <span className="max-w-24 truncate">{name}</span>
            )}
          </button>
        )}
        {/* biome-ignore lint/a11y/useSemanticElements: The original range must retain native text selection and line wrapping. */}
        <span
          data-segment-id={segment.id}
          data-source-byte={start}
          role="button"
          aria-haspopup="dialog"
          aria-description={pending ? t`归属待确认` : name}
          tabIndex={0}
          className={cn(
            "rounded-sm box-decoration-clone focus-visible:outline focus-visible:outline-ring",
            selectedId === segment.id && "bg-accent",
            hoveredId === segment.id && "bg-muted",
          )}
          onPointerEnter={(event) =>
            onHover(segment, event.currentTarget, line.line)
          }
          onPointerLeave={onLeave}
          onFocus={(event) => {
            if (event.target === event.currentTarget)
              onHover(segment, event.currentTarget, line.line);
          }}
          onBlur={onLeave}
          onClick={() => {
            if (window.getSelection()?.isCollapsed) onSelect(segment);
          }}
          onKeyDown={(event) => {
            if (
              event.currentTarget !== event.target ||
              ![" ", "Enter"].includes(event.key)
            )
              return;
            event.preventDefault();
            onOpen(segment, event.currentTarget, line.line);
          }}
          onContextMenu={(event) => {
            if (!window.getSelection()?.isCollapsed) return;
            event.preventDefault();
            onOpen(segment, event.currentTarget, line.line);
          }}
        >
          {content}
        </span>
      </span>
    );
  });
}
