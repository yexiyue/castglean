import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("shared-controls", async ({ flowBrowser: browser }) => {
try {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
    await page.goto(`http://localhost:1437/__geometry?theme=${theme}`);
    const multiline = page.getByRole("button", { name: "Multiline button" });
    assert.deepEqual(await multiline.evaluate(el => { const s = getComputedStyle(el); return [s.paddingTop, s.paddingBottom, s.whiteSpace, s.fontSize]; }), ["8px", "8px", "normal", "12.8px"]);
    const number = page.getByRole("spinbutton", { name: "Number" });
    await number.focus();
    await number.press("ArrowUp");
    assert.equal(await number.inputValue(), "1");
    const invalidNumber = page.getByLabel("Invalid number");
    assert.equal(await invalidNumber.getAttribute("aria-describedby"), "number-error");
    assert.notEqual(await invalidNumber.evaluate(el => getComputedStyle(el).borderColor), await number.evaluate(el => getComputedStyle(el).borderColor));
    assert.equal(await page.getByLabel("Disabled number").isDisabled(), true);
    const groupInput = page.getByRole("textbox", { name: "Group input" });
    const group = groupInput.locator('..');
    assert.equal(await groupInput.getAttribute("aria-invalid"), "true");
    assert.equal(await groupInput.getAttribute("aria-describedby"), "group-help group-error");
    assert.notEqual(await group.evaluate(el => getComputedStyle(el).borderColor), await page.getByRole("textbox", { name: "Input", exact: true }).evaluate(el => getComputedStyle(el).borderColor));
    await groupInput.focus();
    assert.equal(await groupInput.evaluate(el => el === document.activeElement), true);
    assert.notEqual(await group.evaluate(el => getComputedStyle(el).boxShadow), "none");
    await groupInput.press("Tab");
    assert.equal(await page.getByRole("button", { name: "Clear group" }).evaluate(el => el === document.activeElement), true);
    const disabledGroup = page.getByRole("textbox", { name: "Disabled group" });
    assert.equal(await disabledGroup.isDisabled(), true);
    assert.equal(await disabledGroup.locator('..').evaluate(el => getComputedStyle(el).opacity), "0.5");
    assert.equal(await page.getByRole("button", { name: "Disabled button" }).isDisabled(), true);
    const inline = page.getByRole("button", { name: "Inline link" });
    assert.equal(await inline.evaluate(el => getComputedStyle(el).padding), "0px");
    const badge = page.getByText("Muted badge", { exact: true });
    const mutedColor = await page.evaluate(() => { const el = document.createElement("span"); el.className = "text-muted-foreground"; document.body.appendChild(el); const color = getComputedStyle(el).color; el.remove(); return color; });
    assert.equal(await badge.evaluate(el => getComputedStyle(el).color), mutedColor);
    const indicatorColor = label => page.getByRole("progressbar", { name: label }).locator('[data-slot="progress-indicator"]').evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(await indicatorColor("Paused progress"), mutedColor);
    assert.notEqual(await indicatorColor("Active progress"), mutedColor);
    const state = page.getByLabel("controlled state");
    const checkbox = page.getByRole("checkbox", { name: "Check", exact: true });
    const invalidCheckbox = page.getByRole("checkbox", { name: "Invalid checkbox" });
    const invalidRadio = page.getByRole("radio", { name: "Invalid radio" });
    const invalidSelect = page.getByRole("combobox", { name: "Invalid select" });
    for (const [control, description] of [[invalidCheckbox, "checkbox-error"], [invalidRadio, "radio-error"], [invalidSelect, "select-error"]]) {
      assert.equal(await control.getAttribute("aria-invalid"), "true");
      assert.equal(await control.getAttribute("aria-describedby"), description);
    }
    const border = control => control.evaluate(el => getComputedStyle(el).borderColor);
    assert.notEqual(await border(invalidCheckbox), await border(checkbox));
    assert.notEqual(await border(invalidRadio), await border(page.getByRole("radio", { name: "First" })));
    assert.notEqual(await border(invalidSelect), await border(page.getByRole("combobox", { name: "Select", exact: true })));
    for (const control of [page.getByRole("checkbox", { name: "Disabled checkbox" }), page.getByRole("radio", { name: "Disabled radio" }), page.getByRole("combobox", { name: "Disabled select" })]) {
      assert.equal(await control.isDisabled(), true);
      assert.equal(await control.evaluate(el => getComputedStyle(el).opacity), "0.5");
      assert.equal(await control.evaluate(el => el.tabIndex), -1);
    }
    await checkbox.focus(); await checkbox.press("Space");
    assert.equal(await checkbox.isChecked(), true);
    const toggle = page.getByRole("switch", { name: "Enable" });
    const invalidSwitch = page.getByRole("switch", { name: "Invalid switch" });
    assert.equal(await invalidSwitch.getAttribute("aria-describedby"), "switch-error");
    assert.notEqual(await invalidSwitch.evaluate(el => getComputedStyle(el).borderColor), await toggle.evaluate(el => getComputedStyle(el).borderColor));
    const thumbX = async control => control.locator('[data-slot="switch-thumb"]').evaluate(el => el.getBoundingClientRect().x);
    const beforeToggle = await thumbX(toggle);
    await toggle.focus(); await toggle.press("Space");
    assert.equal(await toggle.isChecked(), true);
    await page.waitForTimeout(250);
    assert.ok(Math.abs((await thumbX(toggle)) - beforeToggle - 14) < 0.2);
    assert.ok(Math.abs((await toggle.boundingBox()).height - 18.4) < 0.2);
    const small = page.getByRole("switch", { name: "Small switch" });
    const beforeSmall = await thumbX(small);
    await small.focus(); await small.press("Space");
    assert.equal(await small.isChecked(), true);
    await page.waitForTimeout(250);
    assert.ok(Math.abs((await thumbX(small)) - beforeSmall - 10) < 0.2);
    assert.equal((await small.boundingBox()).height, 14);
    assert.equal(await page.getByRole("switch", { name: "Unavailable" }).isDisabled(), true);
    const first = page.getByRole("radio", { name: "First" });
    await first.focus(); await first.press("ArrowDown");
    assert.equal(await page.getByRole("radio", { name: "Second" }).isChecked(), true);
    const select = page.getByRole("combobox", { name: "Select", exact: true });
    await select.focus(); await select.press("Enter");
    await page.getByRole("option", { name: "Two", exact: true }).click();
    assert.equal(await state.textContent(), "true/true/b/two");
    await select.focus(); await select.press("Enter"); await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Select");
    assert.equal(await select.evaluate(el => el === document.activeElement), true);
    const thumb = toggle.locator('[data-slot="switch-thumb"]');
    const progress = page.getByRole("progressbar", { name: "Active progress" }).locator('[data-slot="progress-indicator"]');
    assert.notEqual(await thumb.evaluate(el => getComputedStyle(el).transitionProperty), "none");
    assert.notEqual(await progress.evaluate(el => getComputedStyle(el).transitionProperty), "none");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await toggle.evaluate(el => getComputedStyle(el).transitionProperty), "none");
    assert.equal(await thumb.evaluate(el => getComputedStyle(el).transitionProperty), "none");
    assert.equal(await progress.evaluate(el => getComputedStyle(el).transitionProperty), "none");
    const beforeReducedToggle = await thumbX(toggle);
    await toggle.focus(); await toggle.press("Space");
    assert.ok(Math.abs((await thumbX(toggle)) - beforeReducedToggle + 14) < 0.2);
    await page.close();
  }
  console.log("PASS shared field errors, focus, disabled and controlled keyboard behavior in both themes");
} finally { await browser.close(); }
});
