import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("chapter-real-media", async ({ flowBrowser: browser }) => {
const page = await browser.newPage();
try {
 await page.goto("http://localhost:1437/");
 await page.evaluate(async () => {
   const { mountPlayer } = await import("/tests/helpers/chapter-player-fixture.tsx");
   window.realPlayer = mountPlayer(true);
   window.realStatus = { run: { id: "real", projectId: "p", chapterId: "c1", chapterTitle: "Chapter 1" }, arrangement: { revision: 1, pauses: [{ afterIndex: 0, durationMs: 500 }] }, units: [0, 1].map((index) => ({ index, mediaId: `unit-${index}`, durationMs: 1200, status: "done", segmentId: `s-${index}` })) };
   window.realPlayer.render(window.realStatus);
   await window.realPlayer.call("start", 0);
 });
 await page.waitForFunction(() => window.realPlayer.snapshot().playing);
 const before = await page.evaluate(() => window.realPlayer.snapshot());
 await page.evaluate(() => window.realPlayer.render({ run: { id: "other", projectId: "p", chapterId: "c2", chapterTitle: "Chapter 2" }, arrangement: { revision: 0, pauses: [] }, units: [] }));
 await page.waitForTimeout(250);
 const during = await page.evaluate(() => window.realPlayer.snapshot());
 assert.equal(during.active, true);
 assert.equal(during.target.chapterId, "c1");
 assert.equal(during.src, before.src);
 assert.ok(during.currentTime > before.currentTime, "real media continues while another chapter is browsed");
 await page.evaluate(() => window.realPlayer.render(window.realStatus));
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
 const disposed = await page.evaluate(() => window.realPlayer.dispose());
 assert.equal(disposed.paused, true);
 assert.equal(disposed.src, "");
 console.log("PASS real PCM audio and silence playback, seek within silence, pause/background/resume and next-unit transition");
} finally { await browser.close(); }
});
