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
import { restoreSourceSelection } from "@/lib/projects/source-selection";
import {
  blankRunHeight,
  isBlankSourceLine,
  mergeBlankRuns,
  type SourceDisplay,
} from "@/lib/projects/source-whitespace";
import { SourceWindow } from "@/lib/projects/source-window";
import { useWorkspaceReader } from "@/lib/workspace/reader";
import { SourceReaderBlocks } from "./source-reader-blocks";
import { useSourceReaderSelection } from "./use-source-reader-selection";

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
  range,
  heading,
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
  range?: ChapterReadingRange;
  heading?: ReactNode;
  display?: SourceDisplay;
  onBlankSelect?: (
    line: TextLine,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => void;
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
  const {
    bookmark,
    selection,
    copyPending,
    copy,
    reset: resetSelection,
  } = useSourceReaderSelection(viewportRef, state.revision, display);
  const [focused, setFocused] = useState<number | null>(null);
  const anchor = useRef<Anchor | null>(null);
  const adjustedTop = useRef<number | null>(null);
  const pendingTarget = useRef<number | null>(targetLine);
  const target = useRef(targetLine);
  target.current = targetLine;
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
    // A line jump places its target below the top of the viewport. Preserve
    // that line through reflow while it is still at the jump offset.
    const atJumpOffset =
      exactTarget &&
      Math.abs(
        exactTarget.getBoundingClientRect().top - viewportTop - targetOffset,
      ) < 2;
    const row =
      exactTarget && (selectedBlankVisible || atJumpOffset)
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
  }, [targetOffset, viewportRef]);
  // Only explicit navigation/retry resets the sparse window. Highlight clicks do not reread.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey explicitly repeats navigation to the same line.
  useEffect(() => {
    resetSelection();
    anchor.current = null;
    adjustedTop.current = null;
    pendingTarget.current = target.current;
    setFocused(null);
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    setScroll((previous) => ({ ...previous, top: 0 }));
    void store.reset(startLine);
    return () => store.dispose();
  }, [store, startLine, reloadKey, viewportRef, resetSelection]);
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
    const before = node.scrollTop;
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
    if (before !== node.scrollTop) adjustedTop.current = node.scrollTop;
    if (targetRow || !anchor.current) remember();
  }, [
    positions,
    bookmark,
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
        className="min-h-0 flex-1 overflow-y-auto px-3 outline-none [overflow-anchor:none] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onScroll={(event) => {
          const { scrollTop, clientHeight } = event.currentTarget;
          if (scrollTop !== adjustedTop.current) remember();
          adjustedTop.current = null;
          setScroll({ top: scrollTop, height: clientHeight });
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
        onCopy={copy}
      >
        <SourceReaderBlocks
          positions={positions}
          retained={retained}
          store={store}
          display={display}
          targetLine={targetLine}
          blanks={blanks}
          renderLine={renderLine}
          renderBlock={renderBlock}
          onMeasure={measure}
          onBlankSelect={onBlankSelect}
        />
        {positions.length > 0 &&
        positions[positions.length - 1].next === null &&
        !state.busy &&
        !state.failed ? (
          <span
            data-slot="chapter-reading-end"
            aria-hidden="true"
            className="block"
          />
        ) : null}
      </section>
      {state.busy ? (
        <p
          role="status"
          className="pointer-events-none absolute bottom-2 left-4 rounded-lg bg-background/95 px-2 py-1 text-xs"
        >
          <Trans>正在读取原文…</Trans>
        </p>
      ) : null}
      {copyPending ? (
        <p
          role="status"
          className="absolute top-2 left-4 bg-background p-2 text-xs"
        >
          <Trans>选区内容正在读取，请稍后复制。</Trans>
        </p>
      ) : null}
      {state.failed ? (
        <div
          role="alert"
          className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-background p-2 text-xs"
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
