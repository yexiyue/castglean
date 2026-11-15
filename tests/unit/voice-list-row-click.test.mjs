import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

// WebKit（macOS 桌面 WebView）忽略表格行上的 position: relative，覆盖层会
// 逃出整行铺满窗口，点击任何位置都触发行内操作。因此表格的整行可点必须
// 用行级 onClick 实现，不得回到「首格按钮 ::after 铺满整行」的写法。
test("voice list rows use a row-level click instead of a stretched overlay", () => {
  const rows = readFileSync("src/components/voices/voice-library-rows.tsx", "utf8");
  assert.ok(
    !/after:absolute[^\n"]*after:inset-0/.test(rows),
    "voice list rows must not use a stretched ::after overlay",
  );
  assert.match(rows, /<TableRow[\s\S]*?onClick=/, "voice list rows need a row-level click handler");

  const table = readFileSync("src/components/ui/table.tsx", "utf8");
  const row = table.slice(table.indexOf("function TableRow"));
  assert.ok(
    !/interactive\s*&&\s*"relative"/.test(row),
    "table rows must not rely on position: relative",
  );
});
