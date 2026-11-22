import { chapterTask } from "../chapter-task.mjs";
import assert from "node:assert/strict";
import { test } from "../managed-browser.mjs";

test("chapter-analysis-matrix", async ({ flowBrowser: browser }) => {
try {
 for (const locale of ["zh","en"]) for(const theme of ["light","dark"]) for(const width of [1360,1024]) {
  const page=await browser.newPage({viewport:{width,height:680}});
  page.setDefaultTimeout(90000);
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  const en=locale==="en";
  await page.goto(`http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&no-default&locale=${locale}&theme=${theme}`);
  const returnToAssistant=page.getByRole("button",{name:en?"AI assistant":"AI 助手",exact:true});
  await returnToAssistant.click();
  const model=page.getByRole("button",{name:en?"Model for the next request":"下次请求使用的模型",exact:true});
  await model.waitFor();
  const analyze=await chapterTask(page, en ? "Analyze chapter characters" : "分析本章角色");
  // Analysis stays disabled until a model is selected in the assistant.
  assert.equal(await analyze.isDisabled(),true);
  await page.keyboard.press("Escape");
  await model.click();
  await page.getByRole("menuitemradio", {name:"合成模型",exact:true}).click();
  await (await chapterTask(page, en ? "Analyze chapter characters" : "分析本章角色")).click();
  await page.locator('[data-segment-id]').nth(1).click();
  await page.getByRole('button',{name:en?'Clip properties':'片段属性',exact:true}).click();
  await page.getByRole("combobox",{name:en?"Speaker":"说话人",exact:true}).waitFor();
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
  assert.deepEqual(errors,[]);
  assert.deepEqual(await page.evaluate(()=>window.fixture.unexpected),[]);
  await page.screenshot({path:`src-tauri/target/workbench-acceptance/analysis-${locale}-${theme}-${width}.png`});
  await page.close();
 }
 console.log("PASS: chapter analysis, explicit model choice with no default, inspector; 8 Chinese/English × light/dark × wide/narrow variants.");
} finally {await browser.close();}
});
