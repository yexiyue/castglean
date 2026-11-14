import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("typeset", async ({ flowBrowser: browser }) => {
const page = await browser.newPage({ viewport: { width: 1024, height: 800 } });
page.setDefaultTimeout(15000);
try {
  await page.goto("http://localhost:1437/tests/typeset-fixture.html");
  const chat = page.locator(".typeset-chat").first();
  const heading = chat.getByRole("heading", { name: "标题" });
  const paragraph = chat.getByText("第一段原有内容。");
  await paragraph.waitFor();
  const before = await heading.evaluate((element) => { const style = getComputedStyle(element); return { top: element.getBoundingClientRect().top, size: style.fontSize, margin: style.marginTop }; });
  assert.equal(before.size, "16px");
  assert.equal(await page.locator('[data-test="excluded"]').evaluate(element => getComputedStyle(element).marginTop), "0px");
  assert.equal(await page.locator('[data-test="nested-excluded"]').evaluate(element => getComputedStyle(element).marginTop), "0px");
  assert.equal(await page.locator('[data-test="excluded-heading"]').evaluate(element => getComputedStyle(element).fontSize), await page.locator('[data-test="excluded-peer"]').evaluate(element => getComputedStyle(element).fontSize));
  assert.equal(await page.locator('[data-test="excluded-heading"]').evaluate(element => getComputedStyle(element).fontWeight), "400");
  assert.equal(await page.getByLabel("文档预设").getByText("文档正文").evaluate(element => parseFloat(getComputedStyle(element).marginTop) > 0), true);
  await page.getByRole("button", { name: "追加流式内容" }).click();
  await chat.getByRole("table").waitFor();
  await chat.getByText("const answer = 42;", { exact: false }).waitFor();
  const after = await heading.evaluate((element) => { const style = getComputedStyle(element); return { top: element.getBoundingClientRect().top, size: style.fontSize, margin: style.marginTop }; });
  assert.deepEqual(after, before);
  assert.equal(await chat.locator('[data-streamdown="code-block"]').count() > 0, true);
  const codeStyles = await chat.locator('[data-streamdown="code-block"]').first().evaluate((block) => {
    const pre = block.querySelector("pre");
    if (!pre) throw new Error("streaming code block has no pre");
    const excluded = document.createElement("div");
    excluded.className = "not-typeset";
    const clone = block.cloneNode(true);
    excluded.append(clone);
    block.closest(".typeset").append(excluded);
    const properties = (element) => { const style = getComputedStyle(element); return [style.fontSize, style.fontFamily, style.padding, style.backgroundColor]; };
    const result = [properties(pre), properties(clone.querySelector("pre"))];
    excluded.remove();
    return result;
  });
  assert.deepEqual(codeStyles[0], codeStyles[1]);
  assert.equal(await page.getByText("工具未完成，已有结果仍保留。").evaluate(element => !!element.closest(".typeset")), false);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  assert.equal(await heading.evaluate(element => getComputedStyle(element).color), await page.locator("body").evaluate(element => getComputedStyle(element).color));
  console.log("PASS typeset streaming, table, code, opt-out and tool isolation");
} finally { await browser.close(); }
});
