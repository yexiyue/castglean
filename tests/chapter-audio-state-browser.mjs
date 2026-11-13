import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
const page = await browser.newPage();
try {
 await page.goto("http://localhost:1437/");
 const result = await page.evaluate(async () => (await import("/tests/helpers/chapter-audio-state-fixture.tsx")).checkAudioStateRaces());
 assert.equal(result.arrangementRevision, 2); assert.equal(result.latest, 3); assert.equal(result.terminal, "failed"); assert.equal(result.active, null); assert.equal(result.afterLateStart, null); assert.equal(result.chapter, "d"); assert.equal(result.starting, false);
 console.log("PASS real generation hook rejects late snapshots, stale events and prior-chapter start responses");
} finally { await browser.close(); }
