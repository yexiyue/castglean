import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("chapter-player", async ({ flowBrowser: browser }) => {
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto("http://localhost:1437/");
  await page.evaluate(async () => {
    const { mountPlayer } = await import("/tests/helpers/chapter-player-fixture.tsx");
    window.player = mountPlayer();
    window.statusFixture = (count, file = null, run = "run", chapter = "chapter-1") => ({
      run: { id: run, projectId: "project-1", chapterId: chapter, chapterTitle: chapter, finalMediaId: file, finalDurationMs: file ? count * 10000 : null },
      units: Array.from({ length: count }, (_, index) => ({ index, durationMs: 10000, mediaId: `unit-${index}`, segmentId: `segment-${index}` })),
    });
    window.player.render(window.statusFixture(3));
  });
  const call = (method, value) => page.evaluate(([method, value]) => window.player.call(method, value), [method, value]);
  const event = (type) => page.evaluate((type) => window.player.event(type), type);
  const snapshot = () => page.evaluate(() => window.player.snapshot());
  await call("start", 1);
  assert.equal((await snapshot()).duration, 20, "partial queue starts at selected unit");
  assert.equal((await snapshot()).time, 0);
  await event("loadedmetadata");
  await call("seek", 12);
  assert.equal((await snapshot()).paused, false, "cross-unit seek preserves playing intent");
  await event("loadedmetadata");
  assert.equal((await snapshot()).currentTime, 2);
  await call("toggle");
  await call("seek", 20);
  assert.equal((await snapshot()).currentTime, 10, "endpoint seek moves the actual final media");
  assert.equal((await snapshot()).paused, true, "paused seeking stays paused");
  await call("seek", 1);
  await event("loadedmetadata");
  assert.equal((await snapshot()).currentTime, 1);
  assert.equal((await snapshot()).paused, true);
  await page.evaluate(() => { const changed = window.statusFixture(4); changed.arrangement = { revision: 2, pauses: [{ afterIndex: 1, durationMs: 500 }] }; window.player.render(changed); });
  assert.equal((await snapshot()).duration, 20, "generation and arrangement changes do not alter a frozen queue");
  await page.evaluate(() => window.player.render(null));
  assert.equal((await snapshot()).active, true, "an empty browsing snapshot does not stop playback");
  await page.evaluate(() => window.player.render(window.statusFixture(2, null, "other-chapter-run", "chapter-2")));
  assert.equal((await snapshot()).active, true, "another chapter's run cannot replace the playing session");
  assert.equal((await snapshot()).target.chapterId, "chapter-1");
  await page.evaluate(() => window.player.render(window.statusFixture(4)));
  await call("toggle");
  await event("ended");
  assert.equal((await snapshot()).unit.index, 2);
  await event("ended");
  assert.equal((await snapshot()).active, false, "newly produced unit is not enqueued");
  assert.equal((await snapshot()).src, "", "stop detaches media");
  await page.evaluate(() => window.player.render(window.statusFixture(3, "chapter")));
  await call("start", 2);
  await event("loadedmetadata");
  assert.equal((await snapshot()).duration, 10);
  assert.equal((await snapshot()).currentTime, 0, "frozen composition begins at selected unit");
  await page.evaluate(() => window.player.render(window.statusFixture(3, "chapter", "other-run")));
  assert.equal((await snapshot()).active, false, "switching run stops playback");
  await page.evaluate(() => {
    const fixture = window.statusFixture(3);
    fixture.units[1].mediaId = null;
    window.player.render(fixture);
  });
  await call("start", 0);
  assert.equal((await snapshot()).duration, 10, "queue stops before a missing unit");
  await event("ended");
  assert.equal((await snapshot()).gapIndex, 1, "the unavailable segment remains visible after stopping");
  assert.equal((await snapshot()).target.chapterId, "chapter-1");
  await page.evaluate(() => {
    const fixture = window.statusFixture(3);
    fixture.arrangement = { revision: 1, pauses: [{ afterIndex: 0, durationMs: 500 }] };
    window.player.render(fixture);
  });
  await call("start", 0);
  assert.equal((await snapshot()).duration, 30.5);
  await call("seek", 10.2);
  await event("loadedmetadata");
  assert.equal((await snapshot()).pauseAfter, 0);
  assert.ok(Math.abs((await snapshot()).currentTime - 0.2) < 0.00001);
  await call("toggle");
  assert.equal((await snapshot()).paused, true, "silence uses media clock and is pausable");
  await event("error");
  assert.equal((await snapshot()).active, false, "a media error releases the playing session");
  assert.equal((await snapshot()).failed, true);
  await call("start", 0);
  const disposed = await page.evaluate(() => window.player.dispose());
  assert.equal(disposed.paused, true, "unmount pauses media");
  assert.equal(disposed.src, "", "unmount detaches the media source");
  assert.deepEqual(errors, []);
  console.log("PASS: player session boundaries, cross-file seeks, endpoint seeks, frozen queues, chapter offsets and cleanup");
} finally {
  await browser.close();
}
});
