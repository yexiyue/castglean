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
      const styles = await content.evaluate(el => ({ animation: getComputedStyle(el).animationName, transition: getComputedStyle(el).transitionProperty, activeAnimations: el.getAnimations().length, animated: window.fixtureAnimatedSlots.includes(el.dataset.slot) }));
      if (motion === "reduce") {
        assert.equal(styles.animation, "none", `${slot} animation`);
        if (slot === "sheet-content") assert.equal(styles.transition, "none", `${slot} transition`);
        if (overlay) {
          const backdrop = page.locator(`[data-slot="${overlay}"]`);
          const style = await backdrop.evaluate(el => ({ animation: getComputedStyle(el).animationName, transition: getComputedStyle(el).transitionProperty, activeAnimations: el.getAnimations().length, animated: window.fixtureAnimatedSlots.includes(el.dataset.slot) }));
          assert.equal(style.animation, "none", `${overlay} animation`);
          if (slot === "sheet-content") assert.equal(style.transition, "none", `${overlay} transition`);
        }
      } else if (slot !== "sheet-content") assert.ok(styles.animation !== "none" || styles.activeAnimations > 0 || styles.animated, `${slot} should retain its normal animation`);
      if (slot === "dropdown-menu-content") {
        const submenu = page.getByRole("menuitem", { name: "Submenu" });
        await submenu.focus(); await submenu.press("ArrowRight");
        const subContent = page.locator('[data-slot="dropdown-menu-sub-content"]');
        await subContent.waitFor({ state: "visible" });
        const subAnimation = await subContent.evaluate(el => ({ name: getComputedStyle(el).animationName, active: el.getAnimations().length, animated: window.fixtureAnimatedSlots.includes(el.dataset.slot) }));
        if (motion === "reduce") assert.equal(subAnimation.name, "none");
        else assert.ok(subAnimation.name !== "none" || subAnimation.active > 0 || subAnimation.animated);
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
    if (motion === "reduce") assert.equal(await content.evaluate(el => getComputedStyle(el).animationName), "none");
    await page.keyboard.press("Escape");
    await content.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Tooltip" }).hover();
    const tooltip = page.locator('[data-slot="tooltip-content"]');
    await tooltip.waitFor({ state: "visible" });
    if (motion === "reduce") assert.equal(await tooltip.evaluate(el => getComputedStyle(el).animationName), "none");
    await page.mouse.move(0, 0);
    const comboPage = await browser.newPage({ reducedMotion: motion });
    await trackAnimations(comboPage);
    await comboPage.goto("http://localhost:1437/tests/combobox-fixture.html");
    const combo = comboPage.getByRole("combobox", { name: "角色选择" });
    await combo.click();
    const comboContent = comboPage.locator('[data-slot="combobox-content"]');
    await comboContent.waitFor({ state: "visible" });
    const comboAnimation = await comboContent.evaluate(el => ({ name: getComputedStyle(el).animationName, active: el.getAnimations().length, animated: window.fixtureAnimatedSlots.includes(el.dataset.slot) }));
    if (motion === "reduce") assert.equal(comboAnimation.name, "none");
    else assert.ok(comboAnimation.name !== "none" || comboAnimation.active > 0 || comboAnimation.animated);
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
