import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("combobox", async ({ flowBrowser: browser }) => {
const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
page.setDefaultTimeout(15000);
try {
  await page.goto("http://localhost:1437/tests/combobox-fixture.html");
  const input = page.getByRole("combobox", { name: "角色选择" });
  await input.fill("同名角色");
  assert.equal(await page.getByRole("option").count(), 2);
  await input.press("ArrowDown");
  await input.press("ArrowDown");
  await input.press("Enter");
  assert.equal(await page.getByLabel("selected").innerText(), "role-149");
  assert.equal(await input.inputValue(), "同名角色 (149)");
  await input.fill("不存在");
  await page.getByText("没有匹配角色").waitFor();
  assert.equal(await page.locator("button").filter({ hasText: /^绑定$/ }).isDisabled(), true);
  await input.press("Escape");
  assert.equal(await page.getByLabel("selected").innerText(), "role-149");
  assert.equal(await input.inputValue(), "同名角色 (149)");
  assert.equal(await page.locator("button").filter({ hasText: /^绑定$/ }).isEnabled(), true);
  await input.fill("同名角色");
  await page.getByRole("option", { name: "同名角色 (148)" }).click();
  assert.equal(await page.getByLabel("selected").innerText(), "role-148");
  await page.getByRole("button", { name: "设置同名角色" }).click();
  assert.equal(await input.inputValue(), "同名角色 (149)");
  await page.getByRole("button", { name: "切换错误" }).click();
  assert.equal(await input.getAttribute("aria-invalid"), "true");
  assert.equal(await input.getAttribute("aria-describedby"), "role-error");
  await page.getByText("请选择角色").waitFor();
  await page.getByRole("button", { name: "清除选择" }).click();
  assert.equal(await page.getByLabel("selected").innerText(), "none");
  await page.getByRole("button", { name: "切换禁用" }).click();
  assert.equal(await input.isDisabled(), true);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  assert.equal(await input.isDisabled(), true);
  console.log("PASS Base UI combobox keyboard, duplicates, controlled value, errors and disabled state");
} finally { await browser.close(); }
});
