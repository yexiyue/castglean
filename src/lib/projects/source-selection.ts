/** Read only source nodes, excluding line numbers and actions from cross-block selections. */
export function sourceSelection(root: HTMLElement | null) {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (
    !root ||
    !range ||
    range.collapsed ||
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>("[data-source-line]"),
  ).filter((node) => range.intersectsNode(node));
  if (!nodes.length) return null;
  let text = "";
  for (const [index, node] of nodes.entries()) {
    if (
      index &&
      Number(node.dataset.sourceLine) !==
        Number(nodes[index - 1].dataset.sourceLine) + 1
    )
      return null;
    const part = range.cloneRange();
    if (!node.contains(range.startContainer)) part.setStart(node, 0);
    if (!node.contains(range.endContainer))
      part.setEnd(node, node.childNodes.length);
    const value = part.toString();
    if (index && !/[\r\n]$/.test(text)) text += "\n";
    text += value;
  }
  return {
    line: Number(nodes[0].dataset.sourceLine),
    endLine: Number(nodes[nodes.length - 1].dataset.sourceLine),
    text,
  };
}

export type SourceSelectionBookmark = {
  anchorLine: number;
  anchorOffset: number;
  focusLine: number;
  focusOffset: number;
};
export function sourceSelectionBookmark(
  root: HTMLElement | null,
): SourceSelectionBookmark | null {
  const selection = window.getSelection();
  if (
    !root ||
    !selection ||
    selection.isCollapsed ||
    !selection.anchorNode ||
    !selection.focusNode
  )
    return null;
  const point = (node: Node, offset: number) => {
    const element = node instanceof Element ? node : node.parentElement;
    const source = element?.closest<HTMLElement>("[data-source-line]");
    if (!source || !root.contains(source)) return null;
    const prefix = document.createRange();
    prefix.selectNodeContents(source);
    prefix.setEnd(node, offset);
    return {
      line: Number(source.dataset.sourceLine),
      offset: prefix.toString().length,
    };
  };
  const anchor = point(selection.anchorNode, selection.anchorOffset),
    focus = point(selection.focusNode, selection.focusOffset);
  return anchor && focus
    ? {
        anchorLine: anchor.line,
        anchorOffset: anchor.offset,
        focusLine: focus.line,
        focusOffset: focus.offset,
      }
    : null;
}
export function restoreSourceSelection(
  root: HTMLElement | null,
  bookmark: SourceSelectionBookmark,
) {
  const point = (line: number, offset: number) => {
    const element = root?.querySelector<HTMLElement>(
      `[data-source-line="${line}"]`,
    );
    if (!element) return null;
    const node = element.firstChild ?? element;
    return {
      node,
      offset: Math.min(
        offset,
        node.nodeType === Node.TEXT_NODE
          ? (node.textContent?.length ?? 0)
          : node.childNodes.length,
      ),
    };
  };
  const anchor = point(bookmark.anchorLine, bookmark.anchorOffset),
    focus = point(bookmark.focusLine, bookmark.focusOffset);
  if (anchor && focus)
    window
      .getSelection()
      ?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
}
