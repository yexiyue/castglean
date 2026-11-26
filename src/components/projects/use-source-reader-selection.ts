import {
  type ClipboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type SourceSelectionBookmark,
  sourceSelection,
  sourceSelectionBookmark,
} from "@/lib/projects/source-selection";
import type { SourceDisplay } from "@/lib/projects/source-whitespace";

function selectedLines(saved: SourceSelectionBookmark) {
  return {
    from: Math.min(saved.anchorLine, saved.focusLine),
    to: Math.max(saved.anchorLine, saved.focusLine),
  };
}

export function useSourceReaderSelection(
  viewport: RefObject<HTMLDivElement | null>,
  revision: number,
  display: SourceDisplay,
) {
  const bookmark = useRef<SourceSelectionBookmark | null>(null);
  const [selection, setSelection] = useState<ReturnType<
    typeof selectedLines
  > | null>(null);
  const [copyPending, setCopyPending] = useState(false);

  useEffect(() => {
    const update = () => {
      const saved = sourceSelectionBookmark(viewport.current);
      bookmark.current = saved;
      const next = saved ? selectedLines(saved) : null;
      setSelection((previous) =>
        previous?.from === next?.from && previous?.to === next?.to
          ? previous
          : next,
      );
      if (!next || sourceSelection(viewport.current)) setCopyPending(false);
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [viewport]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Recheck native selection when hydration or display changes.
  useEffect(() => {
    if (bookmark.current) document.dispatchEvent(new Event("selectionchange"));
  }, [revision, display, selection?.from, selection?.to]);

  function copy(event: ClipboardEvent<HTMLElement>) {
    const value = sourceSelection(viewport.current);
    if (value) {
      event.preventDefault();
      event.clipboardData.setData("text/plain", value.text);
      return;
    }
    const saved = sourceSelectionBookmark(viewport.current);
    if (!saved) return;
    event.preventDefault();
    bookmark.current = saved;
    setSelection(selectedLines(saved));
    setCopyPending(true);
  }

  const reset = useCallback(() => {
    const native = window.getSelection();
    if (native?.anchorNode && viewport.current?.contains(native.anchorNode))
      native.removeAllRanges();
    setSelection(null);
    setCopyPending(false);
  }, [viewport]);

  return { bookmark, selection, copyPending, copy, reset };
}
