import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "vitest";

test("Tailwind permits stock spacing and rejects raw colors and dynamic classes in app code", () => {
  const dir = mkdtempSync(join(tmpdir(), "castglean-tailwind-rules-"));
  try {
    const config = JSON.parse(readFileSync("biome.json", "utf8"));
    config.root = true;
    config.files.includes = ["**/*.tsx"];
    config.tailwind.stylesheet = resolve("src/index.css");
    writeFileSync(join(dir, "biome.json"), JSON.stringify(config));
    const file = join(dir, "probe.tsx");
    const run = (content) => {
      writeFileSync(file, content);
      return spawnSync(resolve("node_modules/.bin/biome"), ["lint", "--config-path", dir, "--only=nursery/noTailwindRawColors", "--only=nursery/useTailwindStaticClassStrings", file], { encoding: "utf8" });
    };
    const valid = run('const probe = <div className="gap-1.5 rounded-2xl bg-primary text-foreground" />;');
    assert.equal(valid.status, 0, valid.stderr);
    for (const [category, source] of [
      ["noTailwindRawColors", '<div className="hover:bg-emerald-600/80" />'],
      ["useTailwindStaticClassStrings", '<div className={`bg-${color}-600`} />'],
    ]) {
      const result = run(`const probe = ${source};`);
      assert.notEqual(result.status, 0, category);
      assert.match(result.stderr, new RegExp(category));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
