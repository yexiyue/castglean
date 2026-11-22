import { chapterTask } from "../chapter-task.mjs";
import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("chapter-agent", async ({ flowBrowser: browser }) => {
try {
 for(const locale of ["zh","en"]) for(const theme of ["light","dark"]) for(const width of [1360,1024]) {
  const page=await browser.newPage({viewport:{width,height:760}});page.setDefaultTimeout(20000);
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  const en=locale==="en";
  const query=`fixture=desktop&analysis=1&agent=1&locale=${locale}&theme=${theme}`;
  await page.goto(`http://localhost:1437/project/fixture-project?${query}`);
  await page.getByRole("button", {name: en ? "Settings" : "设置", exact: true}).click();
  await page.getByRole("button", {name: en ? "Service connections" : "服务连接", exact: true}).click();
  await page.getByRole("button",{name:en?"Edit connection":"编辑连接"}).click();
  const effort=page.locator('select[id$="-reasoning"]');await effort.waitFor();
  assert.deepEqual(await effort.locator("option").evaluateAll(options=>options.map(o=>o.value)),["lowest","low","high","max","provider_default"]);
  await effort.selectOption("high");
  await page.getByRole("button",{name:en?"Save connection":"保存连接",exact:true}).click();
  await page.waitForFunction(()=>window.fixture.calls.some(c=>c.command==="llm_update_connection"));
  assert.equal(await page.evaluate(()=>window.fixture.calls.find(c=>c.command==="llm_update_connection").args.change.models[0].reasoning),"high");
  await page.getByRole("button", {name: en ? "Back" : "返回", exact: true}).click();
  await (await chapterTask(page, en?"Analyze chapter characters":"分析本章角色")).click();
  const results = page.getByRole("log").getByRole("button", {
    name: en ? "Review segments in the inspector" : "在检查器中逐片段审阅",
    exact: true,
  });
  await results.click();
  await page.locator("[data-segment-id]").first().waitFor();
  assert.equal(await page.getByText(en ? "Analysis observations and source findings" : "分析观测与原文疑点", { exact: true }).count(), 0);
  assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.command==="chapter_analysis_edit").length),0);
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
  await page.screenshot({path:`src-tauri/target/workbench-acceptance/agent-${locale}-${theme}-${width}.png`});
  assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.fixture.unexpected),[]);
  await page.close();
 }
 const page=await browser.newPage();
 await page.goto('http://localhost:1437/settings?fixture=desktop&analysis=1&unknown-reasoning=1&section=models');
 await page.getByRole("button",{name:"编辑连接"}).click();
 assert.equal(await page.locator('select[id$="-reasoning"]').isDisabled(),true);
 await page.close();
 console.log('PASS: reasoning settings save supported choices, unknown models stay safe; in-message analysis review; 8 locale/theme/size variants.');
} finally {await browser.close();}
});
