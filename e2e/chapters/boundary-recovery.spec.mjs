import assert from 'node:assert/strict';
import { test } from "../managed-browser.mjs";

test("boundary-recovery", async ({ flowBrowser: browser }) => {
const page=await browser.newPage();page.setDefaultTimeout(15000);
try {
 await page.goto('http://localhost:1437/__boundary-recovery');
 const dialog=page.getByRole('dialog',{name:'调整片段边界'}); const text=dialog.getByRole('textbox',{name:'原文中的拆分位置'});
 await text.waitFor(); await page.waitForFunction(el=>el.value.length>0,await text.elementHandle());
 await text.focus();await text.evaluate(el=>el.setSelectionRange(0,0));await text.press('ArrowRight');
 await dialog.getByRole('button',{name:'在光标处拆分'}).click();
 await dialog.getByText('操作结果尚未确认，原始范围和请求已保留。').waitFor();
 assert.equal(await page.evaluate(()=>window.fixture.pending),true);
 await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(),true);
 await dialog.getByRole('button',{name:'重试原操作'}).click();
 await dialog.getByText('修改已保存，结果读取失败。').waitFor();
 const calls=await page.evaluate(()=>window.fixture.calls); assert.equal(calls.length,2); assert.deepEqual(calls[0],calls[1]);
 assert.equal(calls[0][4].segments[0].range.end,3);
 await dialog.getByRole('button',{name:'重新读取结果'}).click(); await dialog.waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>window.fixture.pending),false);
 assert.equal(await page.evaluate(()=>window.fixture.calls.length),2);
 console.log('PASS boundary UTF-8 coordinates, same-identity retry and read-only recovery');
} finally {await browser.close();}
});
