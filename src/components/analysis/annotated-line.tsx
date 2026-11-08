import { useLingui } from "@lingui/react/macro";
import type { Segment, TextLine } from "@/lib/bindings";
import { cn } from "@/lib/utils";

/** Decorations never contribute characters to source selection or copying. */
export function AnnotatedLine({
  line,
  segments,
  selectedId,
  onSelect,
  highlight,
}: {
  line: TextLine;
  segments: Segment[];
  selectedId: string | null;
  onSelect: (segment: Segment) => void;
  highlight?: { start: number; end: number } | null;
}) {
  const { t } = useLingui();
  const bytes = new TextEncoder().encode(line.text);
  const decoder = new TextDecoder();
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
  let cursor = line.start;
  const parts = [];
  for (const s of visible) {
    const start = Math.max(s.range.start, line.start),
      end = Math.min(s.range.end, line.end);
    if (start > cursor)
      parts.push(<span key={`gap-${cursor}`}>{fragment(cursor, start)}</span>);
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
          s.review === "unreviewed" &&
            "decoration-warning/50 underline decoration-dotted underline-offset-4",
          s.id === selectedId && "bg-accent/50",
        )}
        onClick={() => onSelect(s)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(s);
          }
        }}
      >
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
