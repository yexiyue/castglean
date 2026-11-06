import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Chapter } from "@/lib/bindings";

export function ProposalDirectory({
  chapters,
  onLocate,
}: {
  chapters: Chapter[];
  onLocate: (sourceId: string, line: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const offset = page * 50;
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm">
        <Trans>对照章节目录</Trans>
      </summary>
      {open ? (
        <>
          <ol start={offset + 1} className="max-h-60 overflow-auto text-sm">
            {chapters.slice(offset, offset + 50).map((chapter) => (
              <li key={chapter.id} className="border-b py-1">
                <button
                  type="button"
                  className="text-left underline underline-offset-4"
                  onClick={() =>
                    onLocate(chapter.sourceId, chapter.heading ?? 0)
                  }
                >
                  {chapter.title} · {(chapter.heading ?? 0) + 1}
                </button>
              </li>
            ))}
          </ol>
          {chapters.length > 50 ? (
            <div className="flex items-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                <Trans>上一页</Trans>
              </Button>
              <span className="text-muted-foreground text-xs">
                {page + 1} / {Math.ceil(chapters.length / 50)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + 50 >= chapters.length}
                onClick={() => setPage(page + 1)}
              >
                <Trans>下一页</Trans>
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </details>
  );
}
