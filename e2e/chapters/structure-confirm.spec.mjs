import assert from 'node:assert/strict';
import { test } from "../managed-browser.mjs";

test("structure-confirm", async ({ flowBrowser: browser }) => {
const page=await browser.newPage({viewport:{width:1360,height:900}}); page.setDefaultTimeout(15000);
try {
 await page.goto('http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1');
 const line = page.getByRole("button", { name: "选择第 2 行", exact: true });
 await line.click();
 const action = page.getByRole("button", { name: "从此行分章", exact: true });
 await action.waitFor();
 assert.equal(await page.getByRole("menuitem", { name: "撤销结构调整" }).count(), 0);
 await action.click();
 let dialog=page.getByRole('dialog',{name:'从此行分章'});
 await dialog.waitFor();
 const cancel=dialog.getByRole('button',{name:'取消',exact:true});
 assert.equal(await cancel.evaluate(el=>el===document.activeElement),true);
 assert.match(await dialog.innerText(),/工程：山海之间/);
 assert.match(await dialog.innerText(),/章节：/);
 assert.match(await dialog.innerText(),/来源：.+第 \d+ 行/);
 assert.match(await dialog.innerText(),/历史音频会保留/);
 await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.command==='local_project_edit').length),0);
 await line.click(); await action.click();
 dialog=page.getByRole('dialog',{name:'从此行分章'});
 await page.evaluate(()=>{window.fixture.failEdit=true;});
 await dialog.getByRole('button',{name:'确认调整'}).click();
 await page.getByText('结构操作结果尚未确认，原请求已保留。').waitFor();
 assert.equal(await page.getByTitle("章节更多操作", { exact: true }).isDisabled(),true);

 await page.getByRole('link',{name:'工程首页',exact:true}).click();
 await page.goBack();
 await page.getByText('结构操作结果尚未确认，原请求已保留。').waitFor();
 await page.evaluate(()=>{window.fixture.failEdit=false;});
 await page.getByRole('button',{name:'重试原操作',exact:true}).click();
 await page.getByText('结构操作结果尚未确认，原请求已保留。').waitFor({state:'hidden'});
 const requests=await page.evaluate(()=>window.fixture.calls.filter(c=>c.command==='local_project_edit').map(c=>c.args));
 assert.equal(requests.length,2); assert.deepEqual(requests[0],requests[1]);
 assert.equal(requests[0].edit.correction.sourceId,'source');
 console.log('PASS boundary context, safe focus, cancel and same-operation retry');
} finally { await browser.close(); }
});
