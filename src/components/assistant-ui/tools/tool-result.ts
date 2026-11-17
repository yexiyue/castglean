import type { ResultReference } from "@/lib/bindings";

/** Shape of `TOOL_CALL_RESULT` content produced by the host protocol layer. */
export type ToolResult = {
  output: unknown;
  reference?: ResultReference;
};

/**
 * Host tool results are structured JSON strings (`{"output", "reference"}`).
 * Anything else (legacy strings, empty results) degrades to `null` so callers
 * can skip result affordances instead of guessing.
 */
export function parseToolResult(result: unknown): ToolResult | null {
  if (result == null) return null;
  if (typeof result !== "string") {
    if (typeof result === "object") return result as ToolResult;
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(result);
    if (parsed == null || typeof parsed !== "object") return null;
    return parsed as ToolResult;
  } catch {
    return null;
  }
}
