import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("chapter-agent", async ({ flowBrowser: browser }) => {
try {
 for(const locale of ["zh","en"]) for(const theme of ["light","dark"]) for(const width of [1360,1024]) {
  const page=await browser.newPage({viewport:{width,height:760}});page.setDefaultTimeout(20000);
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  const en=locale==="en";
  const query=`fixture=desktop&analysis=1&agent=1&locale=${locale}&theme=${theme}`;
  await page.goto(`http://localhost:1437/project/fixture-project?${query}&settings=models`);
  await page.getByRole("button",{name:en?"Edit":"编辑",exact:true}).click();
  await page.getByText(en ? "Model settings" : "模型参数", { exact: true }).click();
  const effort=page.locator('select[id$="-reasoning"]');await effort.waitFor();
  assert.deepEqual(await effort.locator("option").evaluateAll(options=>options.map(o=>o.value)),["lowest","low","high","max","provider_default"]);
  await effort.selectOption("high");
  await page.getByRole("button",{name:en?"Save connection":"保存连接",exact:true}).click();
  await page.waitForFunction(()=>window.fixture.calls.some(c=>c.command==="llm_update_connection"));
  assert.equal(await page.evaluate(()=>window.fixture.calls.find(c=>c.command==="llm_update_connection").args.change.models[0].reasoning),"high");
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:en?"Analyze chapter":"分析本章",exact:true}).click();
  await page.getByText(en?"AI review findings, for manual verification only":"AI 预审疑点，仅供人工核对",{exact:true}).waitFor();
  await page.getByRole("button",{name:en?/View finding 1/:/查看疑点 1/}).click();
  assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.command==="chapter_analysis_edit").length),0);
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
  await page.screenshot({path:`src-tauri/target/workbench-acceptance/agent-${locale}-${theme}-${width}.png`});
  assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.fixture.unexpected),[]);
  await page.close();
 }
 const page=await browser.newPage();
 await page.goto('http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&unknown-reasoning=1&settings=models');
 await page.getByRole("button",{name:"编辑",exact:true}).click();
 await page.getByText("模型参数", { exact: true }).click();
 assert.equal(await page.locator('select[id$="-reasoning"]').isDisabled(),true);
 await page.close();
 console.log('PASS: reasoning settings save supported choices, unknown models stay safe; readonly AI findings; 8 locale/theme/size variants.');
} finally {await browser.close();}
});
