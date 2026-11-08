import type { TextLine, TextPage } from "../bindings";
import type { ChapterReadingRange } from "./chapter-reading";
import { type BlankRun, blankRuns } from "./source-whitespace.ts";

export type SourceBlock = {
  from: number;
  to: number;
  next: number | null;
  height: number;
  blanks: BlankRun[];
};
type Snapshot = {
  blocks: SourceBlock[];
  busy: boolean;
  failed: boolean;
  revision: number;
};

/** A sparse reading window, scoped to one immutable source. Heights survive text eviction. */
export class SourceWindow {
  private read: (line: number, count: number) => Promise<TextPage>;
  private hash: string;
  private sourceId: string;
  private range?: ChapterReadingRange;
  private generation = 0;
  private listeners = new Set<() => void>();
  private cache = new Map<number, TextLine[]>();
  private retryAction: (() => Promise<void>) | null = null;
  private snapshot: Snapshot = {
    blocks: [],
    busy: false,
    failed: false,
    revision: 0,
  };
  constructor(
    read: (line: number, count: number) => Promise<TextPage>,
    sourceId: string,
    hash: string,
    range?: ChapterReadingRange,
  ) {
    this.read = read;
    this.sourceId = sourceId;
    this.hash = hash;
    this.range = range;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  lines(from: number) {
    return this.cache.get(from);
  }
  get cachedBlocks() {
    return this.cache.size;
  }
  private publish(change: Partial<Snapshot> = {}) {
    this.snapshot = {
      ...this.snapshot,
      ...change,
      revision: this.snapshot.revision + 1,
    };
    for (const listener of this.listeners) listener();
  }
  private async readRange(
    from: number,
    to?: number,
  ): Promise<{ lines: TextLine[]; next: number | null }> {
    const generation = this.generation;
    const lines: TextLine[] = [];
    let cursor = from;
    let next: number | null = from;
    do {
      if (generation !== this.generation)
        throw new Error("Stale source request");
      const count = Math.min(
        30,
        to === undefined ? 30 : to - cursor,
        this.range?.endLine == null ? 30 : this.range.endLine - cursor,
      );
      if (count <= 0) throw new Error("Outside chapter range");
      const page = await this.read(cursor, count);
      if (generation !== this.generation)
        throw new Error("Stale source request");
      if (
        page.sourceId !== this.sourceId ||
        page.sha256 !== this.hash ||
        !page.lines.length
      )
        throw new Error("Invalid source page");
      for (const [index, item] of page.lines.entries())
        if (item.line !== cursor + index)
          throw new Error("Noncontiguous source page");
      const end = cursor + page.lines.length;
      if (
        (to !== undefined && end > to) ||
        (page.nextLine != null && page.nextLine !== end)
      )
        throw new Error("Invalid source cursor");
      const range = this.range;
      const scoped = range
        ? page.lines.filter(
            (item) =>
              item.start >= range.startByte && item.start < range.endByte,
          )
        : page.lines;
      if (!scoped.length || scoped[0].line !== cursor)
        throw new Error("Outside chapter bytes");
      lines.push(...scoped);
      cursor += scoped.length;
      const chapterEnded =
        this.range &&
        (scoped.length < page.lines.length ||
          scoped[scoped.length - 1].end >= this.range.endByte ||
          (this.range.endLine != null && cursor >= this.range.endLine));
      next = chapterEnded ? null : (page.nextLine ?? null);
      if (to !== undefined && cursor < to && next === null)
        throw new Error("Source range ended early");
    } while (to !== undefined && cursor < to);
    return { lines, next };
  }
  private async perform(action: (generation: number) => Promise<void>) {
    if (this.snapshot.busy || this.snapshot.failed) return;
    const generation = this.generation;
    this.publish({ busy: true });
    try {
      await action(generation);
      if (generation === this.generation) this.retryAction = null;
    } catch {
      if (generation === this.generation) {
        this.retryAction = () => this.perform(action);
        this.publish({ failed: true });
      }
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  reset(from: number) {
    from = Math.max(from, this.range?.startLine ?? 0);
    this.generation++;
    this.retryAction = null;
    this.publish({ busy: false, failed: false });
    return this.perform(async (generation) => {
      const data = await this.readRange(from);
      if (generation !== this.generation) return;
      this.cache.clear();
      this.cache.set(from, data.lines);
      this.publish({
        blocks: [
          {
            from,
            to: from + data.lines.length,
            next: data.next,
            height: data.lines.length * 44,
            blanks: blankRuns(data.lines),
          },
        ],
      });
    });
  }
  dispose() {
    this.generation++;
  }
  retry() {
    const action = this.retryAction;
    this.publish({ failed: false });
    return action?.();
  }
  after() {
    const last = this.snapshot.blocks[this.snapshot.blocks.length - 1];
    if (!last || last.next === null) return;
    const from = last.next;
    return this.perform(async (generation) => {
      const data = await this.readRange(from);
      if (generation !== this.generation) return;
      this.cache.set(from, data.lines);
      this.publish({
        blocks: [
          ...this.snapshot.blocks,
          {
            from,
            to: from + data.lines.length,
            next: data.next,
            height: data.lines.length * 44,
            blanks: blankRuns(data.lines),
          },
        ],
      });
    });
  }
  before() {
    const first = this.snapshot.blocks[0];
    if (!first || first.from <= (this.range?.startLine ?? 0)) return;
    const from = Math.max(this.range?.startLine ?? 0, first.from - 30);
    return this.perform(async (generation) => {
      const data = await this.readRange(from, first.from);
      if (generation !== this.generation) return;
      this.cache.set(from, data.lines);
      this.publish({
        blocks: [
          {
            from,
            to: first.from,
            next: first.from,
            height: data.lines.length * 44,
            blanks: blankRuns(data.lines),
          },
          ...this.snapshot.blocks,
        ],
      });
    });
  }
  hydrate(from: number) {
    const block = this.snapshot.blocks.find((item) => item.from === from);
    if (!block || this.cache.has(from)) return;
    return this.perform(async (generation) => {
      const data = await this.readRange(block.from, block.to);
      if (generation !== this.generation) return;
      this.cache.set(from, data.lines);
      this.publish();
    });
  }
  measure(from: number, height: number) {
    const block = this.snapshot.blocks.find((item) => item.from === from);
    if (!block || Math.abs(block.height - height) < 1) return;
    this.publish({
      blocks: this.snapshot.blocks.map((item) =>
        item.from === from ? { ...item, height } : item,
      ),
    });
  }
  prune(retain: Set<number>) {
    // Visible/selected/focused blocks are never evicted. Ordinary reading keeps at most 12.
    if (this.cache.size <= 12) return;
    for (const from of this.cache.keys()) {
      if (!retain.has(from)) this.cache.delete(from);
      if (this.cache.size <= Math.max(12, retain.size)) break;
    }
  }
}
