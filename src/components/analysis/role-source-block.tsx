import { Trans, useLingui } from "@lingui/react/macro";
import { Play } from "lucide-react";
import type { Segment, TextLine } from "@/lib/bindings";
import { segmentPending } from "@/lib/chapter-audio";
import { cn } from "@/lib/utils";
export interface SegmentPlayback {
  playable: ReadonlySet<string>;
  playingId: string | null;
  toggle: (segmentId: string) => void;
}
export interface SegmentSpeaker {
  id: string;
  displayName: string;
}

/** A bounded source page projected by semantic speaker, without changing source leaves. */
export function RoleSourceBlock({
  lines,
  segments,
  characters,
  selectedId,
  onSelect,
  playback,
  highlight,
  pauses = [],
  onPauseSelect,
}: {
  lines: TextLine[];
  segments: Segment[];
  characters: SegmentSpeaker[];
  selectedId: string | null;
  pauses?: { offset: number; index: number; durationMs: number }[];
  onPauseSelect?: (index: number) => void;
  onSelect: (segment: Segment) => void;
  playback?: SegmentPlayback | null;
  highlight?: { start: number; end: number } | null;
}) {
  const { t } = useLingui();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const fragments: {
    segment: Segment | null;
    line: TextLine;
    start: number;
    end: number;
    text: string;
  }[] = [];
  for (const line of lines) {
    const bytes = encoder.encode(line.text);
    let cursor = line.start;
    for (const segment of segments.filter(
      (s) => s.range.start < line.end && s.range.end > line.start,
    )) {
      const start = Math.max(segment.range.start, line.start),
        end = Math.min(segment.range.end, line.end);
      if (start > cursor)
        fragments.push({
          segment: null,
          line,
          start: cursor,
          end: start,
          text: decoder.decode(
            bytes.subarray(cursor - line.start, start - line.start),
          ),
        });
      fragments.push({
        segment,
        line,
        start,
        end,
        text: decoder.decode(
          bytes.subarray(start - line.start, end - line.start),
        ),
      });
      cursor = end;
    }
    if (cursor < line.end)
      fragments.push({
        segment: null,
        line,
        start: cursor,
        end: line.end,
        text: decoder.decode(bytes.subarray(cursor - line.start)),
      });
  }
  const groups: (typeof fragments)[] = [];
  for (const part of fragments) {
    const last = groups[groups.length - 1];
    if (last && last[0].segment?.id === part.segment?.id) last.push(part);
    else groups.push([part]);
  }
  let previousVisible: Segment | null = null;
  return (
    <div>
      {groups.map((group) => {
        const first = group[0],
          segment = first.segment;
        const name = !segment
          ? ""
          : segment.attribution.state === "narrator"
            ? t`旁白`
            : segment.attribution.state === "resolved"
              ? (characters.find(
                  (c) =>
                    segment.attribution.state === "resolved" &&
                    c.id === segment.attribution.character_id,
                )?.displayName ?? t`未知`)
              : segment.attribution.state === "ambiguous"
                ? t`歧义`
                : t`未知`;
        const whitespace = group.every((part) => !part.text.trim());
        const roleKey = (s: Segment | null) =>
          s?.attribution.state === "resolved"
            ? `role:${s.attribution.character_id}`
            : s?.attribution.state;
        const repeated =
          !!segment &&
          !whitespace &&
          !!previousVisible &&
          roleKey(previousVisible) === roleKey(segment) &&
          !segmentPending(segment);
        if (!whitespace) previousVisible = segment;
        const continuation = segment && first.start > segment.range.start;
        return (
          <div
            key={first.start}
            data-segment-id={segment?.id}
            data-source-row={first.line.line}
            data-source-byte={first.start}
            className={cn(
              "grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 px-3",
              whitespace || repeated ? "py-0" : "pt-3 pb-1",
              segment?.id === selectedId && "bg-accent/50",
              playback?.playingId === segment?.id && "bg-primary/10",
            )}
          >
            <div className="text-muted-foreground flex items-start gap-1 pt-1 text-xs select-none">
              {segment && !whitespace && !repeated && (
                <button
                  type="button"
                  className={cn(
                    "min-w-0 truncate text-left",
                    segmentPending(segment) && "text-warning",
                  )}
                  title={name}
                  onClick={() => onSelect(segment)}
                >
                  {name}
                  {continuation && (
                    <span className="sr-only">
                      <Trans>续</Trans>
                    </span>
                  )}
                </button>
              )}
              {segment && playback?.playable.has(segment.id) && (
                <button
                  type="button"
                  aria-label={t`播放此片段`}
                  onClick={() => playback.toggle(segment.id)}
                >
                  <Play className="size-3.5" />
                </button>
              )}
            </div>
            {/* Source must remain selectable across blocks; keyboard selection is explicit. */}
            {/* biome-ignore lint/a11y/useSemanticElements: A button cannot contain selectable multi-line source content. */}
            <div
              className="min-w-0 text-sm leading-7 wrap-break-word whitespace-pre-wrap"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (
                  e.target === e.currentTarget &&
                  (e.key === "Enter" || e.key === " ") &&
                  segment
                ) {
                  e.preventDefault();
                  onSelect(segment);
                }
              }}
              onClick={() => segment && onSelect(segment)}
            >
              {group.map((part) => {
                const bytes = encoder.encode(part.text);
                const stops = [
                  ...new Set([
                    part.start,
                    part.end,
                    ...(highlight
                      ? [
                          Math.max(
                            part.start,
                            Math.min(part.end, highlight.start),
                          ),
                          Math.max(
                            part.start,
                            Math.min(part.end, highlight.end),
                          ),
                        ]
                      : []),
                    ...pauses
                      .filter(
                        (p) => p.offset > part.start && p.offset <= part.end,
                      )
                      .map((p) => p.offset),
                  ]),
                ].sort((a, b) => a - b);
                const content = stops.slice(1).map((end, i) => {
                  const start = stops[i];
                  const text = decoder.decode(
                    bytes.subarray(start - part.start, end - part.start),
                  );
                  const pause = pauses.find((p) => p.offset === end);
                  const newline = pause
                    ? (text.match(/[\r\n]+$/)?.[0] ?? "")
                    : "";
                  const body = newline ? text.slice(0, -newline.length) : text;
                  return (
                    <span key={end}>
                      {highlight &&
                      start >= highlight.start &&
                      end <= highlight.end ? (
                        <mark className="bg-warning/20 text-inherit">
                          {body}
                        </mark>
                      ) : (
                        body
                      )}
                      {pause && (
                        <span className="select-none">
                          <button
                            type="button"
                            className="text-warning bg-warning/10 mx-1 rounded-sm px-1 text-xs"
                            aria-label={t`停顿 ${pause.durationMs / 1000} 秒`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onPauseSelect?.(pause.index);
                            }}
                          >
                            Ⅱ {pause.durationMs / 1000}s
                          </button>
                        </span>
                      )}
                      {newline}
                    </span>
                  );
                });
                return (
                  <span
                    key={part.start}
                    data-source-row={part.line.line}
                    data-source-byte={part.start}
                    data-source-line={part.line.line}
                    data-source-fragment-offset={
                      decoder.decode(
                        encoder
                          .encode(part.line.text)
                          .subarray(0, part.start - part.line.start),
                      ).length
                    }
                  >
                    {content}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
