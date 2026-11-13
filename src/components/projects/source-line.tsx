import { useLingui } from "@lingui/react/macro";
import type { TextLine } from "@/lib/bindings";

/** Unanalysed source remains compact and keeps its original line coordinates. */
export function SourceLine({
  line,
  highlight,
  onSelect,
}: {
  line: TextLine;
  highlight?: { start: number; end: number } | null;
  onSelect: () => void;
}) {
  const { t } = useLingui();
  const bytes = new TextEncoder().encode(line.text);
  const decoder = new TextDecoder();
  const start = Math.max(line.start, highlight?.start ?? line.end);
  const end = Math.min(line.end, highlight?.end ?? line.start);
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
        onClick={onSelect}
      >
        {line.line + 1}
      </button>
      <pre
        data-source-line={line.line}
        className="min-w-0 flex-1 font-sans text-sm leading-7 wrap-break-word whitespace-pre-wrap select-text"
      >
        {start < end ? (
          <>
            {decoder.decode(bytes.subarray(0, start - line.start))}
            <mark className="bg-warning/20 text-inherit">
              {decoder.decode(
                bytes.subarray(start - line.start, end - line.start),
              )}
            </mark>
            {decoder.decode(bytes.subarray(end - line.start))}
          </>
        ) : (
          line.text
        )}
      </pre>
    </div>
  );
}
