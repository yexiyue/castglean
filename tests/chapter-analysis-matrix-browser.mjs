import assert from "node:assert/strict";
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",headless:true});
try {
 for (const locale of ["zh","en"]) for(const theme of ["light","dark"]) for(const width of [1360,1024]) {
  const page=await browser.newPage({viewport:{width,height:680}});
  page.setDefaultTimeout(90000);
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  const en=locale==="en";
  await page.goto(`http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&no-default&locale=${locale}&theme=${theme}`);
  const model=page.getByRole("combobox",{name:en?"Model for analysis":"分析使用的模型",exact:true});
  await model.waitFor();
  const analyze=page.getByRole("button",{name:en?"Analyze chapter":"分析本章",exact:true});
  // The model chooser is available without opening the assistant or changing settings.
  assert.equal(await analyze.isDisabled(),true);
  await model.selectOption({index:1});
  await analyze.click();
  await page.locator('[data-segment-id]').nth(1).click();
  await page.getByRole("combobox",{name:en?"Speaker":"说话人",exact:true}).waitFor();
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
  assert.deepEqual(errors,[]);
  assert.deepEqual(await page.evaluate(()=>window.fixture.unexpected),[]);
  await page.screenshot({path:`src-tauri/target/workbench-acceptance/analysis-${locale}-${theme}-${width}.png`});
  await page.close();
 }
 console.log("PASS: chapter analysis, explicit model choice with no default, inspector; 8 Chinese/English × light/dark × wide/narrow variants.");
} finally {await browser.close();}
