import assert from 'node:assert/strict';
import { test } from "../managed-browser.mjs";

test("candidate-route-recovery", async ({ flowBrowser: browser }) => {
const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(20000);
try {
 await page.goto('http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&windowFixture=1');
 await page.getByRole('button',{name:'分析本章',exact:true}).click();
 await page.getByRole('button',{name:'重新分析',exact:true}).waitFor();
 await page.getByRole('button',{name:'重新分析',exact:true}).click();
 await page.getByRole('button',{name:'有新的分析候选，查看变化'}).click();
 await page.evaluate(()=>{window.fixture.failCandidateSave=true;});
 await page.getByRole('button',{name:'应用所选变化'}).click();
 await page.getByRole('button',{name:'重试原操作'}).waitFor();
 await page.getByRole('navigation',{name:'工程导航'}).getByRole('button',{name:'制作结果'}).click();
 await page.getByRole('button',{name:'返回章节制作'}).waitFor();
 await page.waitForFunction(()=>typeof window.fixture.fireWindowClose==='function');
 await page.evaluate(()=>window.fixture.fireWindowClose());
 const close=page.getByRole('alertdialog',{name:'关闭 CastGlean？'}); await close.waitFor();
 assert.match(await close.innerText(),/候选操作尚未完成恢复/);
 await close.getByRole('button',{name:'继续使用'}).click();
 await page.getByRole('button',{name:'返回章节制作'}).click();
 await page.getByRole('button',{name:'查看并恢复'}).click();
 await page.getByRole('button',{name:'重试原操作'}).waitFor();
 await page.evaluate(()=>{window.fixture.failCandidateSave=false;});
 await page.getByRole('button',{name:'重试原操作'}).click();
 await page.waitForFunction(()=>window.fixture.calls.filter(c=>c.command==='chapter_analysis_candidate_process').length===2);
 const requests=await page.evaluate(()=>window.fixture.calls.filter(c=>c.command==='chapter_analysis_candidate_process').map(c=>c.args));
 assert.deepEqual(requests[0],requests[1]);
 console.log('PASS candidate recovery across route and native close warning');
} finally {await browser.close();}
});
