import { expect, test } from "@playwright/test";

test("thread viewport follows streaming, keeps the reader's position and offers jump-to-latest", async ({ page }) => {
  await page.goto("/tests/session-messages-fixture.html");
  await expect(page.locator('main[data-ready="true"]')).toBeAttached({ timeout: 20000 });
  const viewport = page.locator('[data-slot="aui_thread-viewport"]');
  await expect(
    viewport.getByText("收到：初始话题 10", { exact: false }),
  ).toBeVisible();
  // Seeded history ends pinned to the newest message.
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThan(64);
  // Scrolling up stops the auto-follow and keeps the reader's position.
  await viewport.hover();
  await page.mouse.wheel(0, -10000);
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBeLessThan(100);
  // The host-provided earlier loader stays available while scrolled up.
  await expect(page.getByRole("button", { name: "加载更早的消息" })).toBeVisible();
  // The jump-to-latest control returns the reader to the end.
  await page.getByRole("button", { name: "回到最新" }).click();
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThan(64);
  // A new run starts below the fold and auto-follow resumes.
  await viewport.hover();
  await page.mouse.wheel(0, -10000);
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBeLessThan(100);
  await page.getByRole("button", { name: "追加消息" }).click();
  await expect(
    viewport.getByText("收到：追加的新消息", { exact: false }).first(),
  ).toBeAttached();
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThan(64);
});

test("message disclosures keep the conversation width and reading position stable", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 680 });
  await page.goto("/tests/session-messages-fixture.html");
  await expect(page.locator('main[data-ready="true"]')).toBeAttached({ timeout: 20000 });
  const viewport = page.locator('[data-slot="aui_thread-viewport"]');
  await viewport.hover();
  await page.mouse.wheel(0, -10000);
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeLessThan(1);

  for (const slot of ["reasoning-trigger", "tool-group-trigger", "tool-fallback-trigger"]) {
    const trigger = viewport.locator(`[data-slot="${slot}"]`).first();
    await expect(trigger).toBeInViewport();
    for (const expanded of [true, false]) {
      const samples = await trigger.evaluate(async (button) => {
        const scroller = button.closest('[data-slot="aui_thread-viewport"]');
        const messages = scroller.querySelector('[data-slot="aui_message-group"]');
        const measure = () => ({
          width: messages.clientWidth,
          top: Math.round(button.getBoundingClientRect().top),
          scrollTop: scroller.scrollTop,
          scrollbar: getComputedStyle(scroller).scrollbarWidth,
        });
        const frames = [measure()];
        button.click();
        const started = performance.now();
        do {
          await new Promise(requestAnimationFrame);
          frames.push(measure());
        } while (performance.now() - started < 250);
        return frames;
      });
      const [before] = samples;
      const label = `${slot} expanded=${expanded}`;
      expect(new Set(samples.map((frame) => frame.width)), label).toEqual(new Set([before.width]));
      expect(new Set(samples.map((frame) => frame.scrollbar)), label).toEqual(new Set([before.scrollbar]));
      expect(Math.max(...samples.map((frame) => Math.abs(frame.top - before.top))), label).toBeLessThanOrEqual(1);
      expect(Math.max(...samples.map((frame) => Math.abs(frame.scrollTop - before.scrollTop))), label).toBeLessThanOrEqual(1);
      await expect(trigger).toHaveAttribute("aria-expanded", String(expanded));
    }
    // The tool call disclosure is inside the tool group.
    if (slot === "tool-group-trigger") await trigger.click();
  }
});
