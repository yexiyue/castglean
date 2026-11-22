import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("save existing and newly created roles from original text without AI", async ({ flowBrowser }) => {
  const page = await flowBrowser.newPage({ viewport: { width: 950, height: 680 } });
  page.setDefaultTimeout(7000);
  try {
    await page.goto(`${process.env.FIXTURE_URL || "http://localhost:1437"}/project/fixture-project?fixture=desktop&analysis=1&no-default=1`);
    const dialog = page.getByRole("dialog", { name: "归属给角色" });
    async function select(lineNumber, text, reverse = false, keyboard = false) {
      if (keyboard) await page.locator('[data-slot="source-scroll"]').focus();
      await page.locator(`[data-source-line="${lineNumber}"]`).evaluate((line, { text, reverse }) => {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.parentElement.closest(".select-none")) continue;
          const start = node.data.indexOf(text);
          if (start < 0) continue;
          const end = start + text.length;
          getSelection().setBaseAndExtent(node, reverse ? end : start, node, reverse ? start : end);
          return;
        }
        throw new Error(`Missing source text: ${text}`);
      }, { text, reverse });
      const action = page.locator('[data-source-actions="selection"]').getByRole("button", { name: "归属给角色" });
      await action.waitFor();
      if (keyboard) await page.keyboard.press("Alt+Enter");
      else await action.click();
      await dialog.getByText(text, { exact: true }).waitFor();
    }
    const writes = () => page.evaluate(() => window.fixture.calls.filter(({ command }) => command === "chapter_analysis_edit"));
    await select(1, "我们走吧。", true);
    await dialog.getByRole("button", { name: "取消" }).click();
    assert.equal((await writes()).length, 0);
    await select(1, "我们走吧。", true);
    await dialog.getByLabel("搜索角色").fill("阿岚");
    await dialog.getByLabel("说话人").selectOption({ label: "阿岚" });
    await dialog.getByRole("button", { name: "保存归属" }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByText("部分已标注", { exact: true }).first().waitFor();
    await select(1, "阿岚说", true, true);
    await dialog.getByLabel("说话人").selectOption({ label: "新建角色" });
    await dialog.getByLabel("角色名称").fill("小舟");
    await page.evaluate(() => { window.fixture.loseManualReply = true; });
    await dialog.getByRole("button", { name: "保存归属" }).click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await dialog.getByRole("button", { name: "取消" }).isDisabled(), true);
    await dialog.getByRole("button", { name: "重试原操作" }).click();
    await dialog.waitFor({ state: "hidden" });

    const [existing, created, retry] = (await writes()).map(({ args }) => args);
    assert.deepEqual(retry, created, "retry keeps the original operation identity and payload");
    const start = Buffer.byteLength("第1章 山雨\r\n");
    const speechStart = start + Buffer.byteLength("阿岚说：“");
    assert.deepEqual(existing.edit.range, { start: speechStart, end: speechStart + Buffer.byteLength("我们走吧。") });
    assert.deepEqual(existing.edit.speaker, { type: "existing", character_id: "character-a" });
    assert.equal(existing.expectedRevision, 0);
    assert.deepEqual(created.edit.range, { start, end: start + Buffer.byteLength("阿岚说") });
    assert.deepEqual(created.edit.speaker, { type: "new", name: "小舟" });
    assert.equal(created.expectedRevision, 1);
    await page.locator("[data-segment-id]").filter({ hasText: "阿岚说" }).hover();
    await page.locator('[data-source-actions="segment"]').getByText("小舟", { exact: true }).waitFor();
    await page.locator('[data-slot="reader-header"]').getByRole("button", { name: "第1章 山雨" }).click();
    await page.getByRole("menuitem", { name: "撤回本章上次归属修改" }).click();
    const undo = page.getByRole("dialog", { name: "撤回本章上次归属修改" });
    await undo.getByRole("button", { name: "确认撤回" }).click();
    await undo.waitFor({ state: "hidden" });
    assert.equal((await writes()).at(-1).args.edit.type, "undo");
    assert.equal(await page.locator("[data-segment-id]").filter({ hasText: "阿岚说" }).count(), 0);
    assert.equal(await page.evaluate(() => window.fixture.calls.some(({ command }) => command === "agent_start" || command === "chapter_analysis_start")), false);
  } finally {
    await page.close();
  }
});
