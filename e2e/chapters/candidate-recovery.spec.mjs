import assert from 'node:assert/strict';
import { test } from "../managed-browser.mjs";

test("candidate-recovery", async ({ flowBrowser: browser }) => {
const page=await browser.newPage(); page.setDefaultTimeout(15000);
try {
 await page.goto('http://localhost:1437/__candidate-recovery');
 await page.getByRole('checkbox',{name:'第 2 项：人工修改冲突'}).check();
 await page.getByRole('button',{name:'应用所选变化'}).click();
 await page.getByText('操作结果尚未确认，所选范围已保留。').waitFor();
 assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),true);
 await page.getByRole('button',{name:'切换候选面板'}).click();
 await page.getByRole('button',{name:'切换候选面板'}).click();
 await page.getByRole('button',{name:'重试原操作'}).click();
 await page.getByText('操作已保存，结果读取失败。').waitFor();
 const calls=await page.evaluate(()=>window.fixture.calls);
 assert.equal(calls.length,2); assert.deepEqual(calls[0],calls[1]);
 assert.equal(calls[0][3],3); assert.deepEqual(calls[0][4],['safe','human']); assert.deepEqual(calls[0][5],['human']);
 await page.getByRole('button',{name:'切换候选面板'}).click();
 await page.evaluate(()=>{window.fixture.failCandidate=true;});
 await page.getByRole('button',{name:'切换候选面板'}).click();
 await page.getByRole('button',{name:'重试读取'}).waitFor();
 await page.getByRole('button',{name:'重新读取结果'}).click();
 await page.waitForFunction(()=>window.fixture.reads===2);
 assert.equal(await page.evaluate(()=>window.fixture.calls.length),2);
 assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),false);
 await page.goto('http://localhost:1437/__candidate-recovery');
 await page.evaluate(()=>{window.fixture.defer=true;window.fixture.lose=false;window.fixture.failRead=false;});
 await page.getByRole('button',{name:'应用所选变化'}).click();
 await page.waitForFunction(()=>typeof window.fixture.release==='function');
 await page.getByRole('button',{name:'切换候选面板'}).click();
 await page.getByRole('button',{name:'切换候选面板'}).click();
 assert.equal(await page.getByRole('button',{name:'应用所选变化'}).isDisabled(),true);
 await page.evaluate(()=>window.fixture.release());
 await page.getByRole('button',{name:'重试原操作'}).click();
 await page.waitForFunction(()=>window.fixture.reads===1);
 const late=await page.evaluate(()=>window.fixture.calls);
 assert.equal(late.length,2); assert.deepEqual(late[0],late[1]);
 await page.goto('http://localhost:1437/__candidate-recovery');
 await page.evaluate(()=>{window.fixture.rejectCode='analysis_source_changed';window.fixture.lose=false;window.fixture.failRead=false;});
 await page.getByRole('button',{name:'应用所选变化'}).click();
 await page.getByRole('button',{name:'重新读取并放弃本次选择'}).click();
 await page.waitForFunction(()=>window.fixture.reads===1);
 assert.equal(await page.evaluate(()=>window.fixture.calls.length),1);
 assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),false);
 console.log('PASS candidate original identity, target isolation, conflict selection and read-only recovery');
} finally {await browser.close();}
});
