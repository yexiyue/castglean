// Run against pnpm desktop:dev after connecting tauri-mcp to its bridge.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const output = execFileSync("tauri-mcp", ["webview-execute-js", "--script",
  '(async () => { try { return JSON.stringify({checks:await (await import("/tests/helpers/hotkeys-fixture.tsx")).checkHotkeys()}); } catch (e) { return JSON.stringify({error:String(e)}); } })()',
], { encoding: "utf8", timeout: 60000 });
const line = output.split("\n").find(line => line.startsWith("{"));
assert.ok(line, output);
const result = JSON.parse(line);
assert.equal(result.error, undefined, result.error);
assert.ok(result.checks.length >= 15, output);
console.log(`PASS ${result.checks.length} native WebView component checks (synthetic keyboard/composition/pointer events)`);
console.log(result.checks.join("\n"));
