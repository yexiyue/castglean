import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import type { ComponentProps } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

export type MarkdownProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code };
// Streamdown keeps its link safety, tables and streaming code renderer; prose
// elements use Typeset rather than Streamdown's fixed utility scales.
const proseComponents = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  ul: "ul",
  ol: "ol",
  li: "li",
  blockquote: "blockquote",
  hr: "hr",
} as const;

/** App-wide assistant markdown renderer: streaming-safe with CJK and code plugins. */
export const Markdown = memo(
  ({ className, ...props }: MarkdownProps) => (
    <Streamdown
      className={cn("typeset size-full", className)}
      plugins={streamdownPlugins}
      components={proseComponents}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating,
);

Markdown.displayName = "Markdown";
