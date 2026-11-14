import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("llm-credentials", async ({ flowBrowser: browser }) => {
try {
  for (const mode of ["keep", "replace", "remove", "cancel"]) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
    page.setDefaultTimeout(15000);
    await page.goto("http://localhost:1437/?fixture=desktop&llmFixture=1&settings=models&locale=zh");
    await page.getByRole("button", { name: "编辑连接" }).click();
    if (mode === "replace" || mode === "cancel") await page.getByLabel("API 密钥").fill("fixture-replacement");
    if (mode === "remove") await page.getByRole("checkbox", { name: "移除密钥，改用无密钥连接" }).check();
    if (mode === "cancel") {
      await page.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(await page.evaluate(() => window.fixture.calls.filter((call) => call.command === "llm_update_connection").length), 0);
      await page.getByRole("button", { name: "编辑连接" }).click();
      assert.equal(await page.getByLabel("API 密钥").inputValue(), "");
    } else {
      await page.getByRole("button", { name: "保存连接", exact: true }).click();
      await page.getByRole("button", { name: "添加连接", exact: true }).waitFor();
      const call = await page.evaluate(() => window.fixture.calls.find((entry) => entry.command === "llm_update_connection"));
      const expected = mode === "replace" ? { kind: "replace", value: "fixture-replacement" } : { kind: mode };
      assert.deepEqual(call.args.change.credential, expected);
      assert.equal("removeKey" in call.args.change, false);
      assert.equal(call.args.change.id, "connection-1");
      assert.equal(call.args.change.expectedRevision, 1);
    }
    await page.close();
  }
  console.log("PASS connection credential keep, replace, remove and cancel");
} finally { await browser.close(); }
});
