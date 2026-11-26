import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function useWorkspacePaneGeometry({
  inCharacterCenter,
  small,
  directoryColumnOpen,
  directoryWidth,
  inspectorWidth,
  headerTarget,
  readOnly,
  visible,
}: {
  inCharacterCenter: boolean;
  small: boolean;
  directoryColumnOpen: boolean;
  directoryWidth: number;
  inspectorWidth: number;
  headerTarget?: HTMLElement | null;
  readOnly: boolean;
  visible: boolean;
}) {
  const paneLayout = useRef<HTMLDivElement>(null);
  const readerLayout = useRef<HTMLDivElement>(null);
  const directoryColumn = useRef<HTMLDivElement>(null);
  const assistantColumn = useRef<HTMLDivElement>(null);
  const [paneLayoutWidth, setPaneLayoutWidth] = useState(0);
  useEffect(() => {
    const layout = paneLayout.current;
    if (!layout) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0)
        setPaneLayoutWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(layout);
    return () => observer.disconnect();
  }, []);
  // The wide character center has its own 288px directory inside the main pane.
  const minimumContentWidth = 304 + (inCharacterCenter && !small ? 288 : 0);
  const maxInspectorWidth = Math.max(
    320,
    Math.min(
      640,
      paneLayoutWidth -
        (directoryColumnOpen ? directoryWidth + 4 : 0) -
        minimumContentWidth,
    ),
  );
  const visibleInspectorWidth = Math.min(inspectorWidth, maxInspectorWidth);
  const [headerGeometry, setHeaderGeometry] = useState({
    directory: 0,
    assistant: 0,
    reader: 0,
  });
  useLayoutEffect(() => {
    const layout = readerLayout.current;
    if (!layout || !headerTarget || !visible) return;
    const updateGeometry = () => {
      const assistant = assistantColumn.current?.getBoundingClientRect();
      const header = headerTarget.getBoundingClientRect();
      const content = layout.getBoundingClientRect();
      // The pane divider is the midpoint of its 4px resize handle.
      const directory =
        directoryColumn.current?.getBoundingClientRect().width ?? 0;
      const left =
        directory > 4
          ? Math.max(content.left - 2, header.left + 28)
          : header.left + 28;
      const right =
        assistant && assistant.width > 4
          ? Math.min(assistant.left + 2, header.right - 36)
          : header.right - (readOnly ? 0 : 36);
      const geometry = {
        directory: left > header.left + 28 ? left - header.left : 0,
        assistant:
          assistant && right < header.right - 36 ? header.right - right - 1 : 0,
        reader: Math.max(0, right - left),
      };
      setHeaderGeometry((previous) =>
        previous.directory === geometry.directory &&
        previous.assistant === geometry.assistant &&
        previous.reader === geometry.reader
          ? previous
          : geometry,
      );
    };
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateGeometry);
    });
    observer.observe(layout);
    observer.observe(headerTarget);
    if (assistantColumn.current) observer.observe(assistantColumn.current);
    updateGeometry();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [headerTarget, readOnly, visible]);

  return {
    paneLayout,
    readerLayout,
    directoryColumn,
    assistantColumn,
    maxInspectorWidth,
    visibleInspectorWidth,
    headerGeometry,
  };
}
