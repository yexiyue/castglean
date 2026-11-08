export type SourceContext = { sourceId: string; line: number; text: string };
const encoder = new TextEncoder();

/** Bounded source previews end on a Unicode code point, never inside UTF-8. */
export function utf8Excerpt(text: string, limit = 1600): string {
  let bytes = 0;
  let result = "";
  for (const character of text) {
    bytes += encoder.encode(character).length;
    if (bytes > limit) break;
    result += character;
  }
  return result;
}
export function sourcePrompt(
  text: string,
  context: SourceContext | null,
  filename: string,
  label: string,
): string {
  if (!context) return text;
  const prefix = `${text}\n\n${label} (${filename}; source_id=${context.sourceId}; line=${context.line}):\n`;
  return prefix + context.text;
}
