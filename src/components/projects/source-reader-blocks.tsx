import { Trans, useLingui } from "@lingui/react/macro";
import {
  type MouseEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from "react";
import type { TextLine } from "@/lib/bindings";
import {
  type BlankRun,
  blankRunHeight,
  isBlankSourceLine,
  type SourceDisplay,
} from "@/lib/projects/source-whitespace";
import type { SourceWindow } from "@/lib/projects/source-window";
import { cn } from "@/lib/utils";

function MeasuredBlock({
  from,
  onMeasure,
  children,
}: {
  from: number;
  onMeasure: (from: number, height: number) => void;
  children: ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const measure = () => {
      if (node.getBoundingClientRect().height)
        onMeasure(from, node.getBoundingClientRect().height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [from, onMeasure]);
  return (
    <div ref={element} data-source-block={from}>
      {children}
    </div>
  );
}

type BlankSelect = (
  line: TextLine,
  event: MouseEvent<HTMLButtonElement>,
) => void;

/** Render hydrated blocks and preserve unhydrated geometry with aggregate spacers. */
export function SourceReaderBlocks({
  positions,
  retained,
  store,
  display,
  targetLine,
  blanks,
  renderLine,
  renderBlock,
  onMeasure,
  onBlankSelect,
}: {
  positions: readonly { from: number; to: number; height: number }[];
  retained: ReadonlySet<number>;
  store: SourceWindow;
  display: SourceDisplay;
  targetLine: number;
  blanks: readonly BlankRun[];
  renderLine: (line: TextLine, lastLine: number) => ReactNode;
  renderBlock?: (lines: TextLine[]) => ReactNode;
  onMeasure: (from: number, height: number) => void;
  onBlankSelect?: BlankSelect;
}) {
  const content: ReactNode[] = [];
  let spacerHeight = 0;
  let spacerFrom = 0;
  const flush = () => {
    if (spacerHeight)
      content.push(
        <div
          key={`spacer-${spacerFrom}`}
          aria-hidden="true"
          data-source-placeholder=""
          style={{ height: spacerHeight }}
        />,
      );
    spacerHeight = 0;
  };
  for (const block of positions) {
    const lines = retained.has(block.from)
      ? store.lines(block.from)
      : undefined;
    if (!lines) {
      if (!spacerHeight) spacerFrom = block.from;
      spacerHeight += block.height;
      continue;
    }
    flush();
    content.push(
      <MeasuredBlock key={block.from} from={block.from} onMeasure={onMeasure}>
        {renderBlock
          ? renderBlock(lines)
          : lines.map((item) => {
              if (display === "original" || !isBlankSourceLine(item.text))
                return renderLine(item, positions[positions.length - 1].to - 1);
              return (
                <CompactBlank
                  key={item.line}
                  item={item}
                  run={blanks.find((blank) => blank.from === item.line)}
                  targetLine={targetLine}
                  onSelect={onBlankSelect}
                />
              );
            })}
      </MeasuredBlock>,
    );
  }
  flush();
  return content;
}

function CompactBlank({
  item,
  run,
  targetLine,
  onSelect,
}: {
  item: TextLine;
  run?: BlankRun;
  targetLine: number;
  onSelect?: BlankSelect;
}) {
  const { t } = useLingui();
  const selected = run && targetLine >= run.from && targetLine < run.to;
  const label = run
    ? t`第 ${run.from + 1}–${run.to} 行，共 ${run.to - run.from} 行空白`
    : "";
  return (
    <div>
      {run ? (
        <div
          data-source-blank-from={run.from}
          data-source-blank-to={run.to}
          data-selected={String(!!selected)}
          className={cn(
            "relative text-xs",
            selected
              ? "bg-accent/30 text-accent-foreground"
              : "text-muted-foreground",
          )}
          style={{ height: blankRunHeight(run) }}
          title={label}
        >
          {run.to - run.from > 1 ? (
            <button
              type="button"
              className="flex size-full items-center gap-2 px-2 text-left text-xs select-none"
              aria-label={label}
              onClick={(event) => onSelect?.(item, event)}
            >
              <span className="tabular-nums">
                {`${run.from + 1}–${run.to}`}
              </span>
              <span>
                <Trans>空行 × {run.to - run.from}</Trans>
              </span>
            </button>
          ) : selected ? (
            <span className="block px-2 text-xs leading-3">
              {run.from + 1} · <Trans>空行</Trans>
            </span>
          ) : (
            <span className="sr-only">{label}</span>
          )}
        </div>
      ) : null}
      <div
        data-source-row={item.line}
        data-source-byte={item.start}
        data-compact-blank=""
        aria-hidden="true"
        className="h-0 overflow-hidden"
      >
        <pre
          data-source-line={item.line}
          className="h-0 text-source-spacer leading-none whitespace-pre-wrap"
        >
          {item.text}
        </pre>
      </div>
    </div>
  );
}
