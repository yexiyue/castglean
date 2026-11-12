import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto("http://localhost:1437/");
  await page.evaluate(async () => {
    const { mountPlayer } = await import("/tests/helpers/chapter-player-fixture.tsx");
    window.player = mountPlayer();
    window.statusFixture = (count, file = null, run = "run") => ({
      run: { id: run, finalMediaId: file, finalDurationMs: file ? count * 10000 : null },
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
  await page.evaluate(() => window.player.render(window.statusFixture(4)));
  assert.equal((await snapshot()).duration, 20, "generation does not extend a frozen queue");
  await call("toggle");
  await event("ended");
  assert.equal((await snapshot()).unit.index, 2);
  await event("ended");
  assert.equal((await snapshot()).active, false, "newly produced unit is not enqueued");
  assert.equal((await snapshot()).src, "", "stop detaches media");
  await page.evaluate(() => window.player.render(window.statusFixture(3, "chapter")));
  await call("start", 2);
  await event("loadedmetadata");
  assert.equal((await snapshot()).duration, 30);
  assert.equal((await snapshot()).currentTime, 20, "chapter file uses absolute offsets");
  await page.evaluate(() => window.player.render(window.statusFixture(3, "chapter", "other-run")));
  assert.equal((await snapshot()).active, false, "switching run stops playback");
  await page.evaluate(() => window.player.dispose());
  assert.deepEqual(errors, []);
  console.log("PASS: player session boundaries, cross-file seeks, endpoint seeks, frozen queues, chapter offsets and cleanup");
} finally {
  await browser.close();
}
