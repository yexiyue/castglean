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
