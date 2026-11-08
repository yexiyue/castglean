import assert from "node:assert/strict";
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",headless:true});
const errors=[];
const visible=button=>button.evaluate(el=>getComputedStyle(document.getElementById(el.getAttribute("aria-controls"))).display!=="none");
async function state(button,value){assert.equal(await button.getAttribute("aria-expanded"),String(value));assert.equal(await visible(button),value);}
try {
 for(const width of [800,1024,1440]) for(const locale of ["zh","en"]) for(const theme of ["light","dark"]) {
  const p=await browser.newPage({viewport:{width,height:720}});p.setDefaultTimeout(60000);p.on("pageerror",e=>errors.push(e.message));
  await p.goto(`http://localhost:1437/project/fixture-project?fixture=desktop&analysis=1&locale=${locale}&theme=${theme}`);
  const en=locale==="en";const bar=p.locator('[data-slot="desktop-bar"]');
  const main=p.getByRole("main",{name:en?"Chapter workspace":"章节工作台",exact:true});await main.waitFor();
  const left=bar.getByRole("button",{name:en?"Directory":"目录",exact:true});const right=bar.getByRole("button",{name:en?"AI assistant":"AI 助手",exact:true});
  await state(left,width>1100);await state(right,true);
  assert.equal(await p.getByRole("group",{name:"制作模式",exact:true}).count(),0);
  assert.equal(await main.evaluate(el=>el.getBoundingClientRect().top),await bar.evaluate(el=>el.getBoundingClientRect().bottom));
  const input=p.getByRole("textbox",{name:en?"Project question or additional details":"工程问题或补充说明",exact:true});await input.fill("draft survives panels");
  await right.click();await state(right,false);await right.click();await state(right,true);assert.equal(await input.inputValue(),"draft survives panels");
  await left.focus();await left.press("Meta+b");await state(left,width<=1100);await left.press("Meta+b");await state(left,width>1100);
  if(!await visible(right)) await right.click();await input.focus();await input.press("Meta+b");await state(right,true);
  await right.focus();await right.press("Meta+Alt+b");await state(right,false);await right.press("Meta+Alt+b");await state(right,true);
  if(width<=1100){await left.click();await state(left,true);await state(right,false);await right.click();await state(right,true);await state(left,false);}
  await p.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
  assert.ok(await bar.evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.deepEqual(await p.evaluate(()=>window.fixture.unexpected),[]);
  await p.screenshot({path:`src-tauri/target/workbench-acceptance/unified-chrome-${width}-${locale}-${theme}.png`});await p.close();
 }
 assert.deepEqual(errors,[]);console.log("PASS: 12 actual-route locales/themes/window sizes; one header, accessible panel toggles, keyboard and input isolation, draft retention, no overflow/errors.");
} finally{await browser.close();}
