import { Trans, useLingui } from "@lingui/react/macro";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import type { TextLine } from "@/lib/bindings";
import type { ChapterReadingRange } from "@/lib/projects/chapter-reading";
import {
  restoreSourceSelection,
  type SourceSelectionBookmark,
  sourceSelection,
  sourceSelectionBookmark,
} from "@/lib/projects/source-selection";
import {
  blankRunHeight,
  isBlankSourceLine,
  mergeBlankRuns,
  type SourceDisplay,
} from "@/lib/projects/source-whitespace";
import { SourceWindow } from "@/lib/projects/source-window";
import { cn } from "@/lib/utils";
import { useWorkspaceReader } from "@/lib/workspace/reader";

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

type Anchor = {
  from: number;
  offset: number;
  line?: number;
  lineOffset?: number;
};
export function VirtualSourceReader({
  projectId,
  sourceId,
  hash,
  startLine,
  targetLine,
  targetOffset = 44,
  reloadKey,
  viewportRef,
  renderLine,
  renderBlock,
  layoutKey = "lines",
  selectionAction,
  range,
  heading,
  ending,
  display = "compact",
  onBlankSelect,
  onLoadedRange,
}: {
  projectId: string;
  sourceId: string;
  hash: string;
  startLine: number;
  targetLine: number;
  targetOffset?: number;
  reloadKey: number;
  viewportRef: RefObject<HTMLDivElement | null>;
  renderLine: (line: TextLine, lastLine: number) => ReactNode;
  renderBlock?: (lines: TextLine[]) => ReactNode;
  layoutKey?: string;
  selectionAction?: ReactNode;
  range?: ChapterReadingRange;
  heading?: ReactNode;
  ending?: ReactNode;
  display?: SourceDisplay;
  onBlankSelect?: (line: TextLine) => void;
  onLoadedRange?: (range: { start: number; end: number }) => void;
}) {
  const { t } = useLingui();
  const reader = useWorkspaceReader();
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only a range boundary change recreates the source window, not a new DTO object.
  const store = useMemo(
    () =>
      new SourceWindow(
        (line, count) =>
          reader.localProjectText(projectId, sourceId, line, count),
        sourceId,
        hash,
        range,
      ),
    [
      projectId,
      reader,
      sourceId,
      hash,
      range?.startLine,
      range?.endLine,
      range?.startByte,
      range?.endByte,
    ],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const loadedLines = state.blocks.flatMap(
    (block) => store.lines(block.from) ?? [],
  );
  const loadedStart = loadedLines[0]?.start;
  const loadedEnd = loadedLines[loadedLines.length - 1]?.end;
  useEffect(() => {
    if (loadedStart != null && loadedEnd != null && loadedStart < loadedEnd)
      onLoadedRange?.({ start: loadedStart, end: loadedEnd });
  }, [loadedStart, loadedEnd, onLoadedRange]);
  const [scroll, setScroll] = useState({ top: 0, height: 680 });
  const [selection, setSelection] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [copyPending, setCopyPending] = useState(false);
  const anchor = useRef<Anchor | null>(null);
  const pendingTarget = useRef<number | null>(targetLine);
  const target = useRef(targetLine);
  target.current = targetLine;
  const bookmark = useRef<SourceSelectionBookmark | null>(null);
  const previousDisplay = useRef(`${layoutKey}:${display}`);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Measurements belong to this source/range window and must reset when its store changes.
  const measurements = useMemo(() => new Map<string, number>(), [store]);
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const blanks = useMemo(
    () => mergeBlankRuns(state.blocks.flatMap((block) => block.blanks)),
    [state.blocks],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: The mutable height map is invalidated by measurementVersion.
  const positions = useMemo(() => {
    let top = 0;
    return state.blocks.map((block) => {
      const owned = blanks.filter(
        (run) => block.from <= run.from && run.from < block.to,
      );
      const blankCount = block.blanks.reduce(
        (sum, run) => sum + run.to - run.from,
        0,
      );
      const key = `${layoutKey}:${display}:${block.from}:${block.to}:${owned.map((run) => `${run.from}:${run.to - run.from === 1}`).join(",")}`;
      const estimated =
        display === "original"
          ? (block.to - block.from) * 44
          : (block.to - block.from - blankCount) * 36 +
            owned.reduce((sum, run) => sum + blankRunHeight(run), 0);
      const height =
        display === "compact" &&
        blankCount === block.to - block.from &&
        !owned.length
          ? 0
          : (measurements.get(key) ?? estimated);
      const position = { ...block, top, height, key };
      top += height;
      return position;
    });
  }, [
    state.blocks,
    blanks,
    display,
    layoutKey,
    measurements,
    measurementVersion,
  ]);
  const currentPositions = useRef(positions);
  currentPositions.current = positions;
  const total = positions.length
    ? positions[positions.length - 1].top +
      positions[positions.length - 1].height
    : 0;
  const positive = positions.filter((block) => block.height > 0);
  const visible = positive.flatMap((block, index) =>
    block.top + block.height >= scroll.top &&
    block.top <= scroll.top + scroll.height
      ? [index]
      : [],
  );
  const first = Math.max(0, (visible[0] ?? 0) - 1);
  const last = Math.min(
    positive.length - 1,
    (visible[visible.length - 1] ?? 0) + 1,
  );
  const retained = new Set(
    positive.slice(first, last + 1).map((block) => block.from),
  );
  const targetIsBlank = blanks.some(
    (run) => run.from <= targetLine && targetLine < run.to,
  );
  for (const block of positions) {
    if (
      (targetIsBlank && block.from <= targetLine && targetLine < block.to) ||
      focused === block.from ||
      (selection && block.to > selection.from && block.from <= selection.to) ||
      (pendingTarget.current !== null &&
        block.from <= pendingTarget.current &&
        pendingTarget.current < block.to)
    )
      retained.add(block.from);
  }
  const remember = useCallback(() => {
    const node = viewportRef.current;
    if (!node || !currentPositions.current.length) return;
    const block =
      currentPositions.current.find(
        (item) => item.top + item.height > node.scrollTop,
      ) ?? currentPositions.current[currentPositions.current.length - 1];
    const viewportTop = node.getBoundingClientRect().top;
    const selectedBlank = Array.from(
      node.querySelectorAll<HTMLElement>("[data-source-blank-from]"),
    ).find(
      (item) =>
        Number(item.dataset.sourceBlankFrom) <= target.current &&
        target.current < Number(item.dataset.sourceBlankTo) &&
        item.getBoundingClientRect().bottom > viewportTop &&
        item.getBoundingClientRect().top < node.getBoundingClientRect().bottom,
    );
    const exactTarget = node.querySelector<HTMLElement>(
      `[data-source-row="${target.current}"]`,
    );
    const exactSource = node.querySelector<HTMLElement>(
      `[data-source-line="${target.current}"]`,
    );
    const selectedBlankVisible =
      selectedBlank ||
      (exactTarget &&
        exactSource &&
        isBlankSourceLine(exactSource.textContent ?? "") &&
        exactTarget.getBoundingClientRect().bottom > viewportTop &&
        exactTarget.getBoundingClientRect().top <
          node.getBoundingClientRect().bottom);
    const row = selectedBlankVisible
      ? exactTarget
      : Array.from(
          node.querySelectorAll<HTMLElement>("[data-source-row]"),
        ).find((item) => item.getBoundingClientRect().bottom > viewportTop);
    anchor.current = {
      from: block.from,
      offset: node.scrollTop - block.top,
      line: row ? Number(row.dataset.sourceRow) : undefined,
      lineOffset: row
        ? row.getBoundingClientRect().top - viewportTop
        : undefined,
    };
  }, [viewportRef]);
  // Only explicit navigation/retry resets the sparse window. Highlight clicks do not reread.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey explicitly repeats navigation to the same line.
  useEffect(() => {
    const native = window.getSelection();
    if (native?.anchorNode && viewportRef.current?.contains(native.anchorNode))
      native.removeAllRanges();
    anchor.current = null;
    pendingTarget.current = target.current;
    setSelection(null);
    setFocused(null);
    setCopyPending(false);
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    setScroll((previous) => ({ ...previous, top: 0 }));
    void store.reset(startLine);
    return () => store.dispose();
  }, [store, startLine, reloadKey, viewportRef]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision also hydrates a block without changing its measured positions.
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node || !positions.length) return;
    if (previousDisplay.current !== `${layoutKey}:${display}`) {
      if (bookmark.current) restoreSourceSelection(node, bookmark.current);
      previousDisplay.current = `${layoutKey}:${display}`;
    }
    const targetRow =
      pendingTarget.current === null
        ? null
        : node.querySelector<HTMLElement>(
            `[data-source-row="${pendingTarget.current}"]`,
          );
    if (targetRow) {
      node.scrollTop = Math.max(
        0,
        node.scrollTop +
          targetRow.getBoundingClientRect().top -
          node.getBoundingClientRect().top -
          targetOffset,
      );
      pendingTarget.current = null;
    } else if (anchor.current) {
      const previous = anchor.current;
      const row =
        previous.line === undefined
          ? null
          : node.querySelector<HTMLElement>(
              `[data-source-row="${previous.line}"]`,
            );
      if (row && previous.lineOffset !== undefined)
        node.scrollTop +=
          row.getBoundingClientRect().top -
          node.getBoundingClientRect().top -
          previous.lineOffset;
      else {
        const block = positions.find((item) => item.from === previous.from);
        if (block) node.scrollTop = block.top + previous.offset;
      }
    }
    setScroll((previous) =>
      previous.top === node.scrollTop
        ? previous
        : { ...previous, top: node.scrollTop },
    );
    remember();
  }, [
    positions,
    state.revision,
    display,
    layoutKey,
    viewportRef,
    remember,
    targetOffset,
  ]);
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      if (node.clientHeight)
        setScroll((previous) =>
          previous.height === node.clientHeight
            ? previous
            : { ...previous, height: node.clientHeight },
        );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [viewportRef]);
  useEffect(() => {
    const update = () => {
      const saved = sourceSelectionBookmark(viewportRef.current);
      bookmark.current = saved;
      const next = saved
        ? {
            from: Math.min(saved.anchorLine, saved.focusLine),
            to: Math.max(saved.anchorLine, saved.focusLine),
          }
        : null;
      setSelection((previous) =>
        previous?.from === next?.from && previous?.to === next?.to
          ? previous
          : next,
      );
      if (!next || sourceSelection(viewportRef.current)) setCopyPending(false);
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [viewportRef]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-evaluate the real DOM selection after pinning/hydration or changing its presentation.
  useEffect(() => {
    if (bookmark.current) document.dispatchEvent(new Event("selectionchange"));
  }, [state.revision, display, selection?.from, selection?.to]);
  // One in-flight operation per source. Visible cache misses take priority over edge prefetch.
  useEffect(() => {
    if (state.busy || state.failed || !positions.length || !scroll.height)
      return;
    store.prune(retained);
    const missing = positions.find(
      (block) => retained.has(block.from) && !store.lines(block.from),
    );
    if (missing) {
      void store.hydrate(missing.from);
      return;
    }
    const end = positions[positions.length - 1];
    if (
      pendingTarget.current !== null &&
      end.to <= pendingTarget.current &&
      end.next !== null
    ) {
      void store.after();
      return;
    }
    if (scroll.top + scroll.height >= total - 240 && end.next !== null) {
      void store.after();
      return;
    }
    if (scroll.top < 240 && positions[0].from > (range?.startLine ?? 0))
      void store.before();
  });
  const measure = useCallback(
    (from: number, height: number) => {
      const block = currentPositions.current.find((item) => item.from === from);
      if (!block || Math.abs((measurements.get(block.key) ?? -1) - height) < 1)
        return;
      measurements.set(block.key, height);
      setMeasurementVersion((version) => version + 1);
    },
    [measurements],
  );
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {heading}
      <section
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Native scrolling of the reading region must be reachable with the keyboard.
        tabIndex={0}
        ref={viewportRef}
        aria-label={t`原文阅读区`}
        aria-busy={state.busy}
        data-slot="source-scroll"
        className="focus-visible:ring-ring min-h-0 flex-1 overflow-y-auto px-3 outline-none [overflow-anchor:none] focus-visible:ring-2 focus-visible:ring-inset"
        onScroll={(event) => {
          remember();
          setScroll({
            top: event.currentTarget.scrollTop,
            height: event.currentTarget.clientHeight,
          });
        }}
        onFocusCapture={(event) => {
          const block = event.target.closest<HTMLElement>(
            "[data-source-block]",
          );
          setFocused(block ? Number(block.dataset.sourceBlock) : null);
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setFocused(null);
        }}
        onCopy={(event) => {
          const value = sourceSelection(viewportRef.current);
          if (value) {
            event.preventDefault();
            event.clipboardData.setData("text/plain", value.text);
          } else {
            const saved = sourceSelectionBookmark(viewportRef.current);
            if (saved) {
              event.preventDefault();
              bookmark.current = saved;
              setSelection({
                from: Math.min(saved.anchorLine, saved.focusLine),
                to: Math.max(saved.anchorLine, saved.focusLine),
              });
              setCopyPending(true);
            }
          }
        }}
      >
        {(() => {
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
              <MeasuredBlock
                key={block.from}
                from={block.from}
                onMeasure={measure}
              >
                {renderBlock
                  ? renderBlock(lines)
                  : lines.map((item) => {
                      if (
                        display === "original" ||
                        !isBlankSourceLine(item.text)
                      )
                        return renderLine(
                          item,
                          positions[positions.length - 1].to - 1,
                        );
                      const run = blanks.find(
                        (blank) => blank.from === item.line,
                      );
                      const selected =
                        run && targetLine >= run.from && targetLine < run.to;
                      const label = run
                        ? t`第 ${run.from + 1}–${run.to} 行，共 ${run.to - run.from} 行空白`
                        : "";
                      return (
                        <div key={item.line}>
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
                                  onClick={() => onBlankSelect?.(item)}
                                >
                                  <span className="tabular-nums">
                                    {run.to - run.from > 1
                                      ? `${run.from + 1}–${run.to}`
                                      : run.from + 1}
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
                    })}
              </MeasuredBlock>,
            );
          }
          flush();
          return content;
        })()}
        {positions.length > 0 &&
        positions[positions.length - 1].next === null &&
        !state.busy &&
        !state.failed ? (
          <footer data-slot="chapter-reading-end" className="border-t p-2">
            {ending}
          </footer>
        ) : null}
      </section>
      {selectionAction ? (
        <div className="absolute top-2 right-4 z-10">{selectionAction}</div>
      ) : null}
      {state.busy ? (
        <p
          role="status"
          className="bg-background/95 rounded-control pointer-events-none absolute bottom-2 left-4 px-2 py-1 text-xs"
        >
          <Trans>正在读取原文…</Trans>
        </p>
      ) : null}
      {copyPending ? (
        <p
          role="status"
          className="bg-background absolute top-2 left-4 p-2 text-xs"
        >
          <Trans>选区内容正在读取，请稍后复制。</Trans>
        </p>
      ) : null}
      {state.failed ? (
        <div
          role="alert"
          className="bg-background border-border rounded-control absolute inset-x-3 bottom-3 flex items-center justify-between gap-2 border p-2 text-xs"
        >
          <span>
            <Trans>无法读取原文，请重新读取。</Trans>
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void store.retry()}
          >
            <Trans>重新读取</Trans>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
