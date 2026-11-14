import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({executablePath:'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:true});
const page=await browser.newPage();page.setDefaultTimeout(15000);
try {
 await page.goto('http://localhost:1437/__segment-recovery');
 await page.getByRole('combobox',{name:'类型'}).selectOption('thought');
 await page.getByRole('button',{name:'重试保存'}).waitFor();
 await page.getByRole('button',{name:'切换片段'}).click();
 assert.equal(await page.getByRole('combobox',{name:'类型'}).inputValue(),'speech');
 assert.equal(await page.getByRole('button',{name:'重试保存'}).count(),0);
 await page.getByRole('button',{name:'切换片段'}).click();
 assert.equal(await page.getByRole('combobox',{name:'类型'}).inputValue(),'thought');
 await page.getByRole('button',{name:'切换面板'}).click(); await page.getByRole('button',{name:'切换面板'}).click();
 assert.equal(await page.getByRole('combobox',{name:'类型'}).inputValue(),'thought');
 await page.getByRole('button',{name:'重试保存'}).click();
 await page.getByText('修改已保存，结果读取失败。').waitFor();
 const calls=await page.evaluate(()=>window.fixture.calls);
 assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
 await page.getByRole('button',{name:'重新读取结果'}).click();
 await page.waitForFunction(()=>window.fixture.reads===2);
 assert.equal(await page.evaluate(()=>window.fixture.calls.length),2);
 console.log('PASS segment draft retention, same-identity retry and read-only recovery');
} finally {await browser.close();}
