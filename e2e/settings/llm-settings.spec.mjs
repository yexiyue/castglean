import assert from 'node:assert/strict';
import { test } from "../managed-browser.mjs";

test("llm-settings", async ({ flowBrowser: browser }) => {
// Run with tests/helpers/serve-fixtures.mjs; all IPC responses are synthetic.



for (const locale of ['zh','en']) for (const theme of ['light','dark']) for (const width of [1024,720]) {
 const page=await browser.newPage({viewport:{width,height:680}});
 await page.goto(`http://localhost:1437/?fixture=desktop&llmFixture=1&settings=models&locale=${locale}&theme=${theme}`);
 await page.getByRole('dialog').waitFor();
 const add=page.getByRole('button',{name:locale==='zh'?'添加连接':'Add connection',exact:true}); await add.click();
 const url=page.locator('input[type=url]'); await url.fill('http://localhost:1234/v1');
 await page.getByLabel(locale === 'zh' ? 'API 密钥' : 'API key', { exact: true }).fill('test-key');
 await page.getByRole('button',{name:locale==='zh'?'获取模型列表':'Fetch model list',exact:true}).click();
 await page.getByText('Remote model').waitFor();
 const call=await page.evaluate(()=>window.fixture.calls.find(x=>x.command==='llm_list_remote_models'));
 assert.equal(call.args.endpoint,'http://localhost:1234/v1'); assert.equal(call.args.credential,'test-key'); assert.equal(call.args.connectionId,null);
 assert.equal(await page.evaluate(()=>window.fixture.calls.some(x=>x.command==='llm_update_connection')),false);
 assert.equal(await page.getByText('32,768', {exact:false}).count()>0,true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.close();
}
const page=await browser.newPage({viewport:{width:1024,height:680}});
await page.goto('http://localhost:1437/?fixture=desktop&llmFixture=1&settings=models&locale=zh&theme=light');
await page.getByRole('button',{name:'编辑',exact:true}).click();
await page.getByRole('button',{name:'获取模型列表',exact:true}).click();
await page.getByText('Remote model').waitFor();
await page.getByText('模型参数', {exact:true}).click();
const effort = page.getByRole('combobox',{name:'思考强度'});
assert.equal(await effort.isDisabled(),false);
await effort.selectOption('high');
assert.equal(await effort.inputValue(),'high');
let call=await page.evaluate(()=>window.fixture.calls.filter(x=>x.command==='llm_list_remote_models').at(-1));
assert.equal(call.args.connectionId,'connection-1');
assert.equal(call.args.credential,null);
await page.getByRole('checkbox',{name:'移除密钥，改用无密钥连接'}).check();
await page.getByRole('button',{name:'获取模型列表',exact:true}).click();
await page.getByText('Remote model').waitFor();
call=await page.evaluate(()=>window.fixture.calls.filter(x=>x.command==='llm_list_remote_models').at(-1));
assert.equal(call.args.credential,'');
await page.close();
await browser.close(); console.log('PASS settings combinations; draft lookup and saved credential choices do not save');
});
