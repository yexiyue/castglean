import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
try {
 await page.goto("http://localhost:1437/");
 await page.evaluate(async () => {
   const { mountPlayer } = await import("/tests/helpers/chapter-player-fixture.tsx");
   window.realPlayer = mountPlayer(true);
   window.realPlayer.render({ run: { id: "real", projectId: "p" }, arrangement: { revision: 1, pauses: [{ afterIndex: 0, durationMs: 500 }] }, units: [0, 1].map((index) => ({ index, mediaId: `unit-${index}`, durationMs: 1200, status: "done", segmentId: `s-${index}` })) });
   await window.realPlayer.call("start", 0);
 });
 await page.waitForFunction(() => window.realPlayer.snapshot().playing);
 await page.evaluate(() => window.realPlayer.call("seek", 1.4));
 await page.waitForFunction(() => window.realPlayer.snapshot().pauseAfter === 0 && window.realPlayer.snapshot().currentTime > 0);
 await page.evaluate(() => window.realPlayer.call("toggle"));
 const frozen = await page.evaluate(() => window.realPlayer.snapshot());
 assert.equal(frozen.paused, true); assert.equal(frozen.pauseAfter, 0);
 const other = await browser.newPage(); await other.goto("about:blank");
 await page.waitForTimeout(250);
 const later = await page.evaluate(() => window.realPlayer.snapshot());
 assert.ok(Math.abs(later.currentTime - frozen.currentTime) < 0.05, "paused silence does not drift while page is hidden");
 await other.close(); await page.bringToFront();
 await page.evaluate(() => window.realPlayer.call("toggle"));
 await page.waitForFunction(() => window.realPlayer.snapshot().unit?.index === 1 && window.realPlayer.snapshot().playing);
 const resumed = await page.evaluate(() => window.realPlayer.snapshot());
 assert.equal(resumed.duration, 2.9); assert.equal(resumed.failed, false);
 await page.evaluate(() => window.realPlayer.dispose());
 console.log("PASS real PCM audio and silence playback, seek within silence, pause/background/resume and next-unit transition");
} finally { await browser.close(); }
