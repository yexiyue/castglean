import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkCss, checkSource } from "../scripts/check-visual-boundaries.mjs";

test("visual boundaries reject raw monochrome utilities and inline appearance", () => {
  for (const source of [
    '<div className="hover:bg-white/30 dark:text-black" />',
    '<div className="[&>span]:!text-white/50 bg-black!" />',
    '<div className="hover:rounded-[7px] text-[23px]" />',
    '<div className="sm:text-4xl hover:rounded-3xl" />',
    '<div className="[color:#245b50]" />',
    '<div className="bg-[#245b50]" />',
    'const styles = cva("border-white/20");',
    '<div style={{ backgroundColor: "red" }} />',
    '<div style={{ "borderRadius": 8 }} />',
    '<div style={{ color: "red" } as CSSProperties} />',
    '<div style={{ ...appearance }} />',
    '<div style={appearance} />',
    '<div style={{ [property]: "red" }} />',
    '<div style={{ "--local-fill": "red" }} />',
    '<div {...{ style: { color: "red" } }} />',
    '<div {...{ style: appearance }} />',
    '<div {...{ ["style"]: { background: "red" } }} />',
    '<div {...{ ...{ style: { borderRadius: 8 } } }} />',
    'const props = { style: { color: "red" } }; <div {...props} />',
    'const visual = { style: { opacity: 0.5 } }; const props = { ...visual }; <div {...props} />',
    'const props = { style: { color: "red" } } as const; <div {...props} />',
    'let props = { style: { color: "red" } }; <div {...props} />',
  ]) assert.ok(checkSource(source).length, source);
  for (const source of [
    '<div className="bg-scrim/30 text-foreground" />',
    '<div className="text-source-spacer rounded-tooltip-arrow grid-cols-[auto_1fr]" />',
    '<div style={{ width: x, height: 20, top: row * 44, left: seconds * zoom }} />',
    '<div style={{ "--sidebar-width": "6rem" } as CSSProperties} />',
    '<div style={{ "--skeleton-width": width }} />',
    '<div {...{ style: { width: position } }} />',
    'const props = { style: { width: position } }; <div {...props} />',
    'const props = { style: { color: "red" } }; function Example(props) { return <div {...props} />; }',
  ]) assert.deepEqual(checkSource(source), [], source);
});

test("CSS color literals are confined to theme definitions", () => {
  for (const source of [
    '.card { color: #245b50 }',
    '.card { background: rgb(1 2 3) }',
    '.card { border-color: red }',
    '.card { --local-color: oklch(50% 0.1 170) }',
    ':root { --local-color: #123456 }',
  ]) assert.ok(checkCss(source, 'src/other.css').length, source);
  assert.deepEqual(checkCss(':root { --foreground: #123456 } .dark { --foreground: #abcdef }', 'src/index.css'), []);
  assert.deepEqual(checkCss('.card { color: var(--foreground); background: color-mix(in oklch, var(--foreground) 20%, transparent); width: 12px }'), []);
  assert.deepEqual(checkCss('.card { background-image: url("red.svg#abc"); color: var(--red-text) }'), []);
  assert.ok(checkCss('.card { color: var(--foreground, red) }').length);
  assert.ok(checkCss('.card { color: #123456 }', 'src/index.css').length);
});

test("workspace visual boundary check succeeds", () => {
  const result = spawnSync(process.execPath, ["scripts/check-visual-boundaries.mjs"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("the command fails on a violation", () => {
  const dir = mkdtempSync(join(tmpdir(), "castglean-visual-"));
  try {
    const file = join(dir, "bad.tsx");
    writeFileSync(file, '<div style={{ color: "red" }} className="bg-white" />');
    const result = spawnSync(process.execPath, ["scripts/check-visual-boundaries.mjs", file], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /semantic color token/);
    assert.match(result.stderr, /inline visual styling/);
    writeFileSync(file, '<div style={{ "--custom": "red" }} className="text-4xl rounded-3xl" />');
    const namedResult = spawnSync(process.execPath, ["scripts/check-visual-boundaries.mjs", file], { encoding: "utf8" });
    assert.notEqual(namedResult.status, 0);
    assert.match(namedResult.stderr, /supported typography or surface size/);
    assert.match(namedResult.stderr, /inline visual styling/);
    writeFileSync(file, 'const visual = { style: { color: "red" } }; const props = { ...visual }; const x = <div {...props} />;');
    const spreadResult = spawnSync(process.execPath, ["scripts/check-visual-boundaries.mjs", file], { encoding: "utf8" });
    assert.notEqual(spreadResult.status, 0);
    assert.match(spreadResult.stderr, /inline visual styling/);
    const css = join(dir, "bad.css");
    writeFileSync(css, '.card { background: #ffffff }');
    const cssResult = spawnSync(process.execPath, ["scripts/check-visual-boundaries.mjs", css], { encoding: "utf8" });
    assert.notEqual(cssResult.status, 0);
    assert.match(cssResult.stderr, /theme color token/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
