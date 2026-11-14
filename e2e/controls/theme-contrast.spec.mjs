import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "../managed-browser.mjs";

test("theme-contrast", async ({ flowBrowser: browser }) => {
const css = await readFile(new URL("../../src/index.css", import.meta.url), "utf8");
const declarations = (selector) => new Set([...css.match(selector)[1].matchAll(/--([\w-]+)\s*:/g)].map((match) => match[1]).filter((name) => !["app-header-height", "radius", "corner-control", "corner-item", "corner-surface", "corner-overlay"].includes(name)));
assert.deepEqual(declarations(/:root\s*\{([^}]+)\}/), declarations(/\.dark\s*\{([^}]+)\}/));



try {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:1437/__geometry?theme=${theme}`);
    const scrim = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      return [10, 30].map((opacity) => {
        const element = document.createElement("div");
        element.className = `bg-scrim/${opacity}`;
        document.body.append(element);
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = getComputedStyle(element).backgroundColor;
        ctx.fillRect(0, 0, 1, 1);
        element.remove();
        return [...ctx.getImageData(0, 0, 1, 1).data];
      });
    });
    assert.deepEqual(scrim, [[0, 0, 0, 26], [0, 0, 0, 77]], `${theme} scrim`);
    const geometry = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.className = "text-source-spacer rounded-tooltip-arrow shadow-sidebar-outline";
      document.body.append(probe);
      const style = getComputedStyle(probe);
      const result = { fontSize: style.fontSize, radius: style.borderRadius, shadow: style.boxShadow };
      probe.remove();
      return result;
    });
    assert.equal(geometry.fontSize, "0px");
    assert.equal(geometry.radius, "2px");
    assert.match(geometry.shadow, /0px 0px 0px 1px/);
    const logoSizes = await page.getByLabel("model logo sizes").locator('[data-slot="model-logo"]').evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element);
      return [element.getBoundingClientRect().width, style.paddingTop];
    }));
    assert.deepEqual(logoSizes, [[24, "2px"], [36, "4px"], [48, "4px"], [24, "2px"], [20, "0px"], [48, "0px"]]);
    const results = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      const color = (value) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = value.trim();
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data].map((n) => n / 255);
      };
      const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
      const luminance = (rgb) => rgb.slice(0, 3).reduce((sum, v, i) => sum + [0.2126, 0.7152, 0.0722][i] * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), 0);
      const ratio = (a, b) => {
        const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
        return (high + 0.05) / (low + 0.05);
      };
      const token = (name) => color(root.getPropertyValue(`--${name}`));
      const pairs = [
        ["foreground", "background", 4.5], ["foreground", "card", 4.5],
        ["muted-foreground", "card", 4.5], ["primary-foreground", "primary", 4.5],
        ["accent-foreground", "accent", 4.5], ["primary", "primary-weak", 4.5],
        ["success", "success-weak", 4.5], ["warning", "warning-weak", 4.5],
        ["destructive", "destructive-weak", 4.5], ["info", "info-weak", 4.5],
        ["input", "card", 3], ["ring", "card", 3],
      ];
      return pairs.map(([fg, bg, minimum]) => ({ name: `${fg}/${bg}`, value: ratio(token(fg), token(bg)), minimum }));
    });
    for (const result of results) assert.ok(result.value >= result.minimum, `${theme} ${result.name}: ${result.value.toFixed(2)} < ${result.minimum}`);
    const input = page.getByRole("textbox", { name: "Input", exact: true });
    const boundary = await input.evaluate((element) => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      const color = (value) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((n) => n / 255); };
      const lum = (rgb) => rgb.slice(0, 3).reduce((s, v, i) => s + [0.2126, 0.7152, 0.0722][i] * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), 0);
      const style = getComputedStyle(element);
      const base = color(getComputedStyle(document.documentElement).getPropertyValue("--background").trim());
      const fill = color(style.backgroundColor);
      const background = fill.slice(0, 3).map((v, i) => v * fill[3] + base[i] * (1 - fill[3]));
      const [lo, hi] = [lum(color(style.borderTopColor)), lum(background)].sort((x, y) => x - y);
      return (hi + 0.05) / (lo + 0.05);
    });
    assert.ok(boundary >= 3, `${theme} rendered input boundary: ${boundary.toFixed(2)}`);
    await input.focus();
    await page.waitForTimeout(250);
    const focused = await input.evaluate((element) => getComputedStyle(element).boxShadow);
    const ringColor = focused.match(/(oklab\([^)]*\)|rgba?\([^)]*\)) 0px 0px 0px 3px/)?.[1];
    assert.ok(ringColor, `${theme}: focus ring absent`);
    const button = page.getByRole("button", { name: "default", exact: true });
    await button.hover();
    await page.waitForTimeout(250);
    const rendered = await button.evaluate((element, ring) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      const color = (value) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((n) => n / 255); };
      const blend = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
      const lum = (rgb) => rgb.slice(0, 3).reduce((s, v, i) => s + [0.2126, 0.7152, 0.0722][i] * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), 0);
      const contrast = (a, b) => { const [lo, hi] = [lum(a), lum(b)].sort((x, y) => x - y); return (hi + 0.05) / (lo + 0.05); };
      const surface = color(getComputedStyle(document.documentElement).getPropertyValue("--background").trim());
      const style = getComputedStyle(element);
      return { hover: contrast(color(style.color), blend(color(style.backgroundColor), surface)), focus: contrast(blend(color(ring), surface), surface) };
    }, ringColor);
    assert.ok(rendered.hover >= 4.5, `${theme} hover text: ${rendered.hover.toFixed(2)}`);
    assert.ok(rendered.focus >= 3, `${theme} focus ring: ${rendered.focus.toFixed(2)}`);
    const slider = page.getByRole("slider", { name: "Test progress" });
    assert.equal(await page.getByRole("button", { name: "sm", exact: true }).evaluate((element) => getComputedStyle(element).fontSize), "12.8px");
    assert.equal(await page.getByRole("button", { name: "Small toggle" }).evaluate((element) => getComputedStyle(element).fontSize), "12.8px");
    assert.equal(await page.getByRole("checkbox", { name: "Check", exact: true }).evaluate((element) => getComputedStyle(element).borderRadius), "4px");
    const secondary = page.getByRole("button", { name: "Secondary" });
    const beforeHover = await secondary.evaluate((element) => getComputedStyle(element).backgroundColor);
    await secondary.hover();
    await page.waitForTimeout(200);
    const afterHover = await secondary.evaluate((element) => getComputedStyle(element).backgroundColor);
    assert.notEqual(afterHover, beforeHover, `${theme} secondary hover color`);
    assert.equal(await slider.getAttribute("aria-valuenow"), "25");
    assert.equal(await slider.getAttribute("aria-valuetext"), "25%");
    assert.equal(await slider.getAttribute("min"), "0");
    assert.equal(await slider.getAttribute("max"), "100");
    assert.equal(await slider.getAttribute("step"), "1");
    await slider.focus();
    await page.waitForTimeout(250);
    assert.match(await slider.evaluate((element) => getComputedStyle(element.parentElement).boxShadow), /0px 0px 0px 3px/);
    await slider.press("ArrowRight");
    assert.equal(await slider.getAttribute("aria-valuenow"), "26");
    assert.equal(await slider.getAttribute("aria-valuetext"), "26%");
    console.log(`PASS ${theme}: ${results.map((r) => `${r.name} ${r.value.toFixed(2)}`).join(", ")}; input ${boundary.toFixed(2)}, hover ${rendered.hover.toFixed(2)}, focus ${rendered.focus.toFixed(2)}`);
    await page.close();
  }
} finally {
  await browser.close();
}
});
