import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

async function trackAnimations(page) {
  await page.addInitScript(() => {
    window.fixtureAnimatedSlots = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const slot = this.getAttribute("data-slot");
      if (slot) window.fixtureAnimatedSlots.push(slot);
      return animate.apply(this, args);
    };
  });
}

test("overlay-motion", async ({ flowBrowser: browser }) => {
try {
  for (const motion of ["reduce", "no-preference"]) {
    const page = await browser.newPage({ reducedMotion: motion, viewport: { width: 1024, height: 680 } });
    await trackAnimations(page);
    await page.goto("http://localhost:1437/__geometry");
    for (const [button, slot, overlay] of [["Dialog", "dialog-content", "dialog-overlay"], ["Alert", "alert-dialog-content", "alert-dialog-overlay"], ["Sheet", "sheet-content", "sheet-overlay"], ["Popover", "popover-content", null], ["Menu", "dropdown-menu-content", null]]) {
      const trigger = page.getByRole("button", { name: button, exact: true });
      await trigger.click();
      const content = page.locator(`[data-slot="${slot}"]`);
      await content.waitFor({ state: "visible" });
      if (slot === "dialog-content") assert.equal(await content.evaluate(el => getComputedStyle(el).padding), "16px");
      for (const element of [content, ...(overlay ? [page.locator(`[data-slot="${overlay}"]`)] : [])]) {
        const styles = await element.evaluate(el => {
          const css = getComputedStyle(el);
          return {
            animation: css.animationName,
            transition: css.transitionDuration,
            motion: el.getAnimations().length > 0 ||
              window.fixtureAnimatedSlots.includes(el.dataset.slot) ||
              Boolean(el.style.transform && el.style.transform !== "none"),
          };
        });
        assert.equal(styles.animation, "none", `${slot} CSS animation (${motion})`);
        assert.equal(styles.transition, "0s", `${slot} CSS transition (${motion})`);
        if (motion === "no-preference" && element === content)
          assert.ok(styles.motion, `${slot} retains its Motion animation`);
      }
      if (slot === "dropdown-menu-content") {
        const submenu = page.getByRole("menuitem", { name: "Submenu" });
        await submenu.focus(); await submenu.press("ArrowRight");
        const subContent = page.locator('[data-slot="dropdown-menu-sub-content"]');
        await subContent.waitFor({ state: "visible" });
        const subAnimation = await subContent.evaluate(el => ({ name: getComputedStyle(el).animationName, active: el.getAnimations().length, animated: window.fixtureAnimatedSlots.includes(el.dataset.slot) }));
        assert.equal(subAnimation.name, "none");
        if (motion === "no-preference") assert.ok(subAnimation.active > 0 || subAnimation.animated);
        await page.keyboard.press("Escape");
        await subContent.waitFor({ state: "hidden" });
      }
      await page.keyboard.press("Escape");
      await content.waitFor({ state: "hidden" });
      await page.waitForFunction(el => el === document.activeElement, await trigger.elementHandle());
    }
    const select = page.getByRole("combobox", { name: "Select", exact: true });
    await select.click();
    const content = page.locator('[data-slot="select-content"]');
    await content.waitFor({ state: "visible" });
    assert.equal(await content.evaluate(el => getComputedStyle(el).animationName), "none");
    await page.keyboard.press("Escape");
    await content.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Tooltip" }).hover();
    const tooltip = page.locator('[data-slot="tooltip-content"]');
    await tooltip.waitFor({ state: "visible" });
    assert.equal(await tooltip.evaluate(el => getComputedStyle(el).animationName), "none");
    await page.mouse.move(0, 0);
    const comboPage = await browser.newPage({ reducedMotion: motion });
    await trackAnimations(comboPage);
    await comboPage.goto("http://localhost:1437/tests/combobox-fixture.html");
    const combo = comboPage.getByRole("combobox", { name: "角色选择" });
    await combo.click();
    const comboContent = comboPage.locator('[data-slot="combobox-content"]');
    await comboContent.waitFor({ state: "visible" });
    const comboAnimation = await comboContent.evaluate(el => ({ name: getComputedStyle(el).animationName, active: el.getAnimations().length, animated: window.fixtureAnimatedSlots.includes(el.dataset.slot) }));
    assert.equal(comboAnimation.name, "none");
    if (motion === "no-preference") assert.ok(comboAnimation.active > 0 || comboAnimation.animated);
    await combo.press("Escape");
    await comboContent.waitFor({ state: "hidden" });
    assert.equal(await combo.evaluate(el => el === document.activeElement), true);
    await comboPage.close();
    const dialogTrigger = page.getByRole("button", { name: "Dialog", exact: true });
    for (let index = 0; index < 5; index++) {
      await dialogTrigger.click();
      await page.locator('[data-slot="dialog-content"]').waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      await page.locator('[data-slot="dialog-content"]').waitFor({ state: "hidden" });
      await page.waitForFunction(el => el === document.activeElement, await dialogTrigger.elementHandle());
    }
    await page.close();
  }
  console.log("PASS overlay and menu reduced motion, normal animation and Escape focus restoration");
} finally { await browser.close(); }
});
