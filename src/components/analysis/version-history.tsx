import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type Chapter_Serialize,
  type Character,
  commands,
  type Excerpt,
  type Segment,
  type VersionCursor,
  type VersionSummary,
} from "@/lib/bindings";

/** Historical annotations are read-only, including versions from removed chapter boundaries. */
export function VersionHistory({
  open,
  onOpenChange,
  projectId,
  chapters,
  characters,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  projectId: string;
  chapters: Chapter_Serialize[];
  characters: Character[];
}) {
  const { t, i18n } = useLingui();
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [cursor, setCursor] = useState<VersionCursor | null>(null);
  const [selected, setSelected] = useState<VersionSummary | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [scroll, setScroll] = useState(0);
  const [snippet, setSnippet] = useState<Excerpt | null>(null);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const read = useRef(0);
  const versionRequests = useRef(0);
  const listRequests = useRef(0);
  const listingMore = useRef(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void reloadKey;
    listRequests.current++;
    listingMore.current = false;
    setLoading(true);
    setVersions([]);
    setCursor(null);
    setFailed(false);
    setSelected(null);
    void commands
      .chapterAnalysisVersions(projectId, null)
      .then((page) => {
        if (live) {
          setVersions(page.versions);
          setCursor(page.next);
        }
      })
      .catch(() => {
        if (live) setFailed(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      read.current++;
      listRequests.current++;
    };
  }, [open, projectId, reloadKey]);
  useEffect(() => {
    if (!open || !selected) return;
    versionRequests.current++;
    let live = true;
    setSegments([]);
    setNext(null);
    setSnippet(null);
    setScroll(0);
    setFailed(false);
    busy.current = true;
    void commands
      .chapterAnalysisSegments(
        projectId,
        selected.id,
        { start: selected.source.start, end: selected.source.end },
        null,
      )
      .then((page) => {
        if (live) {
          setSegments(page.segments);
          setNext(page.nextStart);
        }
      })
      .catch(() => {
        if (live) setFailed(true);
      })
      .finally(() => {
        if (live) busy.current = false;
      });
    return () => {
      live = false;
      read.current++;
      versionRequests.current++;
    };
  }, [open, projectId, selected]);
  async function more() {
    if (busy.current || !selected || next === null) return;
    busy.current = true;
    const request = versionRequests.current;
    try {
      const page = await commands.chapterAnalysisSegments(
        projectId,
        selected.id,
        { start: selected.source.start, end: selected.source.end },
        next,
      );
      if (request !== versionRequests.current) return;
      setSegments((old) => [...old, ...page.segments]);
      setNext(page.nextStart);
    } catch {
      if (request === versionRequests.current) setFailed(true);
    } finally {
      if (request === versionRequests.current) busy.current = false;
    }
  }
  async function inspect(segment: Segment) {
    if (!selected) return;
    const id = ++read.current;
    try {
      const result = await commands.chapterAnalysisVersionExcerpt(
        projectId,
        selected.id,
        segment.range,
      );
      if (id === read.current) setSnippet(result);
    } catch {
      if (id === read.current) setFailed(true);
    }
  }
  const first = Math.max(0, Math.floor(scroll / 44) - 3),
    last = Math.min(segments.length, first + 13);
  function speaker(segment: Segment) {
    const attribution = segment.attribution;
    switch (attribution.state) {
      case "narrator":
        return t`旁白`;
      case "unknown":
        return t`未知`;
      case "ambiguous":
        return t`保留歧义`;
      case "resolved":
        return (
          characters.find((c) => c.id === attribution.character_id)
            ?.displayName ?? t`未知`
        );
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col">
        <DialogHeader>
          <DialogTitle>
            <Trans>分析版本历史</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>历史仅供查看，不覆盖当前分析或人工修改。</Trans>
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          <div className={selected ? "hidden" : "flex flex-col gap-1"}>
            {versions.map((v) => (
              <Button
                key={v.id}
                variant="ghost"
                className="h-auto justify-start py-2 text-left whitespace-normal"
                onClick={() => setSelected(v)}
              >
                <span>
                  {chapters.find((c) => c.id === v.chapterId)?.title ??
                    t`已调整的章节`}
                  <span className="text-muted-foreground block text-xs">
                    {new Date(Number(v.createdAt) * 1000).toLocaleString(
                      i18n.locale,
                    )}{" "}
                    · <Trans>{v.segmentCount} 个片段</Trans>
                  </span>
                </span>
              </Button>
            ))}
            {cursor ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  if (listingMore.current) return;
                  listingMore.current = true;
                  const request = listRequests.current;
                  try {
                    const page = await commands.chapterAnalysisVersions(
                      projectId,
                      cursor,
                    );
                    if (request === listRequests.current) {
                      setVersions((old) => [...old, ...page.versions]);
                      setCursor(page.next);
                    }
                  } catch {
                    if (request === listRequests.current) setFailed(true);
                  } finally {
                    if (request === listRequests.current)
                      listingMore.current = false;
                  }
                }}
              >
                <Trans>更早的分析</Trans>
              </Button>
            ) : null}
            {!versions.length && !loading && !failed ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                <Trans>尚无分析记录</Trans>
              </p>
            ) : null}
          </div>
          {selected ? (
            <div className="flex flex-col gap-3">
              <Button
                className="self-start"
                size="sm"
                variant="ghost"
                onClick={() => setSelected(null)}
              >
                <Trans>返回记录</Trans>
              </Button>
              <section
                aria-label={t`历史片段`}
                className="relative h-64 overflow-y-auto"
                onScroll={(e) => {
                  setScroll(e.currentTarget.scrollTop);
                  if (
                    e.currentTarget.scrollHeight -
                      e.currentTarget.scrollTop -
                      e.currentTarget.clientHeight <
                    100
                  )
                    void more();
                }}
              >
                <div
                  style={{ height: segments.length * 44 }}
                  className="relative"
                >
                  {segments.slice(first, last).map((s, index) => (
                    <Button
                      key={s.id}
                      variant="ghost"
                      size="sm"
                      className="absolute inset-x-1 justify-start text-left"
                      style={{ top: (first + index) * 44, height: 40 }}
                      onClick={() => void inspect(s)}
                    >
                      {speaker(s)} ·{" "}
                      {s.review === "confirmed" ? t`人工已确认` : t`待审阅`}
                    </Button>
                  ))}
                </div>
              </section>
              {next !== null ? (
                <Button size="sm" variant="ghost" onClick={() => void more()}>
                  <Trans>读取更多</Trans>
                </Button>
              ) : null}
              {snippet ? (
                <pre className="max-h-40 overflow-y-auto border-t pt-3 font-sans text-sm leading-7 wrap-anywhere whitespace-pre-wrap">
                  {snippet.text}
                  {snippet.truncated ? "…" : ""}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
        {failed ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setReloadKey((n) => n + 1)}
          >
            <Trans>重试读取</Trans>
          </Button>
        ) : null}
        {failed ? (
          <p role="alert" className="text-destructive text-sm">
            <Trans>历史暂时无法读取，当前结果未改变。</Trans>
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
